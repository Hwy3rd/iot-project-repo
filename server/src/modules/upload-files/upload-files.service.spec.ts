import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MINIO_CLIENT } from '../../libs/minio/minio.constant';
import { UploadFilesService } from './upload-files.service';

describe('UploadFilesService', () => {
  let service: UploadFilesService;
  const client = {
    putObject: jest.fn(),
    removeObject: jest.fn(),
  };

  const config: Record<string, string> = {
    MINIO_BUCKET: 'iot-uploads',
    MINIO_USE_SSL: 'false',
    MINIO_ENDPOINT: 'minio',
    MINIO_PORT: '9000',
    MINIO_PUBLIC_URL: 'http://localhost:9000',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadFilesService,
        { provide: MINIO_CLIENT, useValue: client },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = module.get<UploadFilesService>(UploadFilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('uploads an image and returns its public URL', async () => {
    const file = {
      originalname: 'avatar.png',
      mimetype: 'image/png',
      size: 123,
      buffer: Buffer.from('fake'),
    } as Express.Multer.File;

    const url = await service.uploadImage(file, 'users');

    expect(client.putObject).toHaveBeenCalledWith(
      'iot-uploads',
      expect.stringMatching(/^users\/.+\.png$/),
      file.buffer,
      file.size,
      { 'Content-Type': 'image/png' },
    );
    expect(url).toMatch(
      /^http:\/\/localhost:9000\/iot-uploads\/users\/.+\.png$/,
    );
  });

  it('deletes an image by extracting its key from the public URL', async () => {
    await service.deleteImage(
      'http://localhost:9000/iot-uploads/users/some-id.png',
    );

    expect(client.removeObject).toHaveBeenCalledWith(
      'iot-uploads',
      'users/some-id.png',
    );
  });

  it('does nothing when the URL does not belong to this bucket', async () => {
    await service.deleteImage('http://other-host/other-bucket/x.png');

    expect(client.removeObject).not.toHaveBeenCalled();
  });
});
