import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

export const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const imageUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: IMAGE_MAX_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new BadRequestException('Only image files are allowed'), false);
      return;
    }
    callback(null, true);
  },
};
