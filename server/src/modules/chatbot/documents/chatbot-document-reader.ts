import { BadRequestException, Injectable } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';
import { extname, win32 } from 'node:path';
import { TextDecoder } from 'node:util';
import { abortable } from '../tools/chatbot-rag';

export const DOCUMENT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TEXT_MAX_CHARS = 60_000;
export const DOCUMENT_PDF_MAX_PAGES = 40;
const ALLOWED = new Set(['.md', '.txt', '.pdf']);
export const documentUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: DOCUMENT_FILE_MAX_BYTES, files: 1, fields: 2 },
  fileFilter: (_request, file, callback) => {
    if (!ALLOWED.has(extname(file.originalname).toLowerCase())) {
      callback(
        new BadRequestException(
          'Chỉ nhận tài liệu Markdown (.md), TXT hoặc PDF có văn bản.',
        ),
        false,
      );
    } else callback(null, true);
  },
};

@Injectable()
export class ChatbotDocumentReader {
  async read(file: Express.Multer.File | undefined): Promise<{
    text: string;
    filename: string;
    mimeType: string;
    pages: number | null;
  }> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Hãy chọn một tài liệu để tải lên.');
    if (file.buffer.length > DOCUMENT_FILE_MAX_BYTES)
      throw new BadRequestException('Tài liệu tối đa 5 MB.');
    const filename = win32
      .basename(file.originalname)
      .replace(/\p{Cc}/gu, '')
      .slice(0, 255);
    const extension = extname(filename).toLowerCase();
    if (!ALLOWED.has(extension))
      throw new BadRequestException('Định dạng tài liệu không được hỗ trợ.');
    let text: string;
    let pages: number | null = null;
    if (extension === '.pdf') {
      if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw new BadRequestException('File không phải PDF hợp lệ.');
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({
        data: new Uint8Array(file.buffer),
        isEvalSupported: false,
      });
      const signal = AbortSignal.timeout(15000);
      try {
        const result = await abortable(
          (async () => {
            const info = await parser.getInfo();
            if (info.total > DOCUMENT_PDF_MAX_PAGES)
              throw new BadRequestException('PDF tối đa 40 trang.');
            const content = await parser.getText();
            return {
              text: content.pages.map((page) => page.text).join('\n\n'),
              pages: info.total,
            };
          })(),
          signal,
        );
        text = result.text;
        pages = result.pages;
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(
          'Không đọc được PDF. Hãy dùng PDF có văn bản, không khóa mật khẩu; PDF scan cần chuyển thành văn bản trước.',
        );
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      } catch {
        throw new BadRequestException('File MD/TXT phải được lưu bằng UTF-8.');
      }
      if (
        text.includes('\0') ||
        file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
      )
        throw new BadRequestException(
          'Nội dung file không phải văn bản hợp lệ.',
        );
    }
    text = text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .trim();
    if ((text.match(/\p{L}/gu)?.length ?? 0) < 10)
      throw new BadRequestException(
        'Tài liệu không có đủ văn bản để đọc. PDF scan chưa được hỗ trợ OCR.',
      );
    if (text.length > DOCUMENT_TEXT_MAX_CHARS)
      throw new BadRequestException(
        'Nội dung tối đa 60.000 ký tự. Hãy chia tài liệu thành các phần nhỏ hơn.',
      );
    return {
      text,
      filename,
      pages,
      mimeType: extension === '.pdf' ? 'application/pdf' : 'text/plain',
    };
  }
}
