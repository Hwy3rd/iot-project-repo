import { BadRequestException } from '@nestjs/common';
import {
  ChatbotDocumentReader,
  DOCUMENT_FILE_MAX_BYTES,
} from './chatbot-document-reader';

const file = (name: string, buffer: Buffer) =>
  ({ originalname: name, buffer, size: buffer.length }) as Express.Multer.File;
// A tiny PDF generated entirely in this test; verifies the actual parser, without downloads.
function pdf(text: string): Buffer {
  const stream = `BT /F1 14 Tf 30 150 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('');
  output += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

describe('ChatbotDocumentReader', () => {
  const reader = new ChatbotDocumentReader();
  it('accepts Vietnamese UTF-8 and normalizes line endings', async () => {
    const result = await reader.read(
      file('guide.md', Buffer.from('# Hướng dẫn\r\nKiểm tra cửa phòng.')),
    );
    expect(result.text).toBe('# Hướng dẫn\nKiểm tra cửa phòng.');
    expect(result.mimeType).toBe('text/plain');
  });
  it('extracts real text from a PDF', async () => {
    const result = await reader.read(
      file('guide.pdf', pdf('Cold room operating instructions')),
    );
    expect(result.text).toContain('Cold room operating instructions');
    expect(result.pages).toBe(1);
  });
  it('rejects a PDF with no usable text instead of indexing page markers', async () => {
    await expect(reader.read(file('scan.pdf', pdf('')))).rejects.toThrow(
      'không có đủ văn bản',
    );
  });
  it.each(['report.exe', 'guide.docx', 'guide.pdf.exe'])(
    'rejects unsupported format %s',
    async (name) => {
      await expect(
        reader.read(file(name, Buffer.from('Operating instructions'))),
      ).rejects.toThrow(BadRequestException);
    },
  );
  it('rejects a PDF spoofed by extension', async () => {
    await expect(
      reader.read(file('fake.pdf', Buffer.from('not a real PDF file'))),
    ).rejects.toThrow('không phải PDF');
  });
  it('rejects PDF bytes disguised as TXT', async () => {
    await expect(
      reader.read(file('fake.txt', pdf('Some text'))),
    ).rejects.toThrow('không phải văn bản');
  });
  it('rejects broken UTF-8, binary text, oversized and blank files', async () => {
    await expect(
      reader.read(file('bad.txt', Buffer.from([255, 254, 0, 1]))),
    ).rejects.toThrow('UTF-8');
    await expect(
      reader.read(file('bad.md', Buffer.from('some\0binary content'))),
    ).rejects.toThrow('không phải văn bản');
    await expect(
      reader.read(file('huge.txt', Buffer.alloc(DOCUMENT_FILE_MAX_BYTES + 1))),
    ).rejects.toThrow('5 MB');
    await expect(
      reader.read(file('empty.md', Buffer.from('   '))),
    ).rejects.toThrow('không có đủ văn bản');
  });
  it('limits extracted text length and strips path segments from display names', async () => {
    await expect(
      reader.read(file('big.txt', Buffer.from('a'.repeat(60001)))),
    ).rejects.toThrow('60.000');
    expect(
      (
        await reader.read(
          file(
            'C:\\folder\\guide.md',
            Buffer.from('Useful operating instructions'),
          ),
        )
      ).filename,
    ).toBe('guide.md');
  });
});
