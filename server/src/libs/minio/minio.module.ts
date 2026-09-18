import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleInit,
  Provider,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { MINIO_CLIENT } from './minio.constant';

const minioProvider: Provider = {
  provide: MINIO_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Client({
      endPoint: config.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: Number(config.get<string>('MINIO_PORT') ?? 9000),
      useSSL: config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: config.get<string>('MINIO_ACCESS_KEY') ?? 'minioadmin',
      secretKey: config.get<string>('MINIO_SECRET_KEY') ?? 'minioadmin',
    }),
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [minioProvider],
  exports: [MINIO_CLIENT],
})
export class MinioModule implements OnModuleInit {
  private readonly logger = new Logger(MinioModule.name);

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const bucket = this.config.get<string>('MINIO_BUCKET') ?? 'iot-uploads';
    const exists = await this.client.bucketExists(bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(bucket);
      this.logger.log(`Created MinIO bucket "${bucket}"`);
    }

    // Uploaded images (avatars, warehouse/product photos) are referenced by
    // plain URL from MySQL columns, so the bucket must allow anonymous reads.
    await this.client.setBucketPolicy(
      bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      }),
    );
  }
}
