import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Client } from 'minio';
import { MINIO_CLIENT } from '../../libs/minio/minio.constant';

@Injectable()
export class UploadFilesService {
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('MINIO_BUCKET') ?? 'iot-uploads';
    const useSSL = this.config.get<string>('MINIO_USE_SSL') === 'true';
    const endpoint = this.config.get<string>('MINIO_ENDPOINT') ?? 'localhost';
    const port = this.config.get<string>('MINIO_PORT') ?? '9000';
    this.publicUrl =
      this.config.get<string>('MINIO_PUBLIC_URL') ??
      `${useSSL ? 'https' : 'http'}://${endpoint}:${port}`;
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const key = `${folder}/${randomUUID()}${extname(file.originalname)}`;
    await this.client.putObject(this.bucket, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });
    return `${this.publicUrl}/${this.bucket}/${key}`;
  }

  uploadImages(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<string[]> {
    return Promise.all(files.map((file) => this.uploadImage(file, folder)));
  }

  async deleteImage(url: string): Promise<void> {
    const key = this.extractKey(url);
    if (!key) {
      return;
    }
    await this.client.removeObject(this.bucket, key);
  }

  private extractKey(url: string): string | null {
    const prefix = `${this.publicUrl}/${this.bucket}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
