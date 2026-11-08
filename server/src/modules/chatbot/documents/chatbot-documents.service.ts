import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { QUEUE_NAMES } from '../../../libs/constants/queue.constant';
import {
  CHATBOT_SEARCHABLE_DOCS,
  RAG_DIMENSIONS,
  RAG_MODEL,
  abortable,
  chunkDocument,
  loadCorpus,
  normalizeVector,
  type AdditionalDocument,
} from '../tools/chatbot-rag';
import { ChatbotDocument } from './chatbot-document.entity';
import { ChatbotDocumentReader } from './chatbot-document-reader';
import { ChatbotEmbeddingService } from './chatbot-embedding.service';

export interface DocumentJob {
  id: string;
  token: string;
}
export const MAX_UPLOAD_DOCUMENTS = 30;
export const MAX_UPLOAD_CHUNKS = 250;
const sourceFile = (id: string) => `uploaded/${id}.md`;
const asMarkdown = (title: string, text: string) =>
  `# ${title.replace(/[\r\n]/g, ' ')}\n\n${text}`;

@Injectable()
export class ChatbotDocumentsService {
  private readonly logger = new Logger(ChatbotDocumentsService.name);
  constructor(
    @InjectRepository(ChatbotDocument)
    private readonly repo: Repository<ChatbotDocument>,
    @InjectQueue(QUEUE_NAMES.CHATBOT_DOCUMENTS)
    private readonly queue: Queue<DocumentJob>,
    private readonly reader: ChatbotDocumentReader,
    private readonly embedding: ChatbotEmbeddingService,
    private readonly config: ConfigService,
  ) {}
  private get docsDir() {
    return (
      this.config.get<string>('CHATBOT_DOCS_DIR') ||
      join(process.cwd(), '..', 'docs')
    );
  }

  async overview() {
    const [items, corpus] = await Promise.all([
      this.repo.find({ order: { createdAt: 'DESC' } }),
      loadCorpus(this.docsDir),
    ]);
    return {
      items,
      builtins: CHATBOT_SEARCHABLE_DOCS.map((filename) => {
        const chunks = corpus.chunks.filter((c) => c.file === filename);
        return {
          filename,
          title: chunks[0]?.title ?? filename,
          chunkCount: chunks.length,
          available: !corpus.missing.includes(filename),
        };
      }),
      processingAvailable: this.embedding.available,
      knowledgeMode: this.config.get<string>('CHATBOT_KNOWLEDGE_MODE') || 'rag',
      maxDocuments: MAX_UPLOAD_DOCUMENTS,
    };
  }
  async builtin(filename: string) {
    if (!(CHATBOT_SEARCHABLE_DOCS as readonly string[]).includes(filename))
      throw new NotFoundException('Không tìm thấy tài liệu.');
    let textContent: string;
    try {
      textContent = await readFile(join(this.docsDir, filename), 'utf8');
    } catch {
      throw new NotFoundException('Tài liệu hệ thống chưa có trên máy chủ.');
    }
    const chunks = chunkDocument(filename, textContent);
    return {
      filename,
      title: chunks[0]?.title ?? filename,
      chunkCount: chunks.length,
      available: true,
      textContent,
    };
  }
  async detail(id: string) {
    const document = await this.repo.findOne({
      where: { id },
      select: {
        id: true,
        title: true,
        filename: true,
        mimeType: true,
        bytes: true,
        pages: true,
        status: true,
        chunkCount: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        textContent: true,
      },
    });
    if (!document) throw new NotFoundException('Không tìm thấy tài liệu.');
    return document;
  }

  async upload(
    file: Express.Multer.File | undefined,
    title: string,
    userId: string,
  ) {
    if (!file)
      throw new BadRequestException('Hãy chọn một tài liệu để tải lên.');
    if (title.trim().length < 3 || title.trim().length > 180)
      throw new BadRequestException('Tên tài liệu cần từ 3 đến 180 ký tự.');
    const current = await this.repo.find({
      select: { id: true, chunkCount: true },
    });
    if (current.length >= MAX_UPLOAD_DOCUMENTS)
      throw new BadRequestException(
        'Đã đạt giới hạn 30 tài liệu tải lên. Hãy xóa tài liệu không còn sử dụng.',
      );
    const extracted = await this.reader.read(file);
    const id = randomUUID();
    const chunks = chunkDocument(
      sourceFile(id),
      asMarkdown(title.trim(), extracted.text),
    );
    if (!chunks.length)
      throw new BadRequestException('Không tìm thấy nội dung để xử lý.');
    if (
      current.reduce((sum, d) => sum + d.chunkCount, 0) + chunks.length >
      MAX_UPLOAD_CHUNKS
    )
      throw new BadRequestException(
        'Kho tài liệu đã đầy. Hãy rút gọn hoặc xóa tài liệu không còn dùng.',
      );
    const document = this.repo.create({
      id,
      title: title.trim(),
      filename: extracted.filename,
      mimeType: extracted.mimeType,
      bytes: file.buffer.length,
      pages: extracted.pages,
      status: 'pending',
      chunkCount: chunks.length,
      contentHash: createHash('sha256').update(extracted.text).digest('hex'),
      createdBy: userId,
      textContent: extracted.text,
      embeddingData: null,
      jobToken: null,
      error: null,
    });
    try {
      return await this.repo.save(document);
    } catch (error) {
      if (
        (error as { driverError?: { code?: string } }).driverError?.code ===
        'ER_DUP_ENTRY'
      )
        throw new ConflictException('Nội dung tài liệu này đã được tải lên.');
      throw error;
    }
  }

  async enqueue(id: string) {
    if (!this.embedding.available)
      throw new BadRequestException(
        'Chưa cấu hình dịch vụ AI để xử lý tài liệu. Tài liệu vẫn được lưu để xử lý sau.',
      );
    await this.detail(id);
    const token = randomUUID();
    const update = await this.repo.update(
      { id, status: In(['pending', 'failed', 'ready']) },
      { status: 'queued', jobToken: token, error: null },
    );
    if (!update.affected)
      throw new ConflictException('Tài liệu đang chờ hoặc đang được xử lý.');
    try {
      await this.queue.add(
        'index-document',
        { id, token },
        {
          jobId: token,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch {
      await this.repo.update(
        { id, jobToken: token },
        {
          status: 'failed',
          error: 'Không đưa được tài liệu vào hàng đợi. Hãy thử lại.',
        },
      );
      throw new BadRequestException(
        'Không kết nối được dịch vụ xử lý. Hãy thử lại.',
      );
    }
    return this.detail(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });
    if (!result.affected)
      throw new NotFoundException('Không tìm thấy tài liệu.');
    // Queue jobs only carry ids/tokens; deleted documents cannot be published later.
  }

  async process(job: DocumentJob): Promise<void> {
    const claimed = await this.repo.update(
      { id: job.id, jobToken: job.token, status: In(['queued', 'processing']) },
      { status: 'processing', error: null },
    );
    if (!claimed.affected) return;
    const row = await this.repo.findOne({
      where: { id: job.id },
      select: { id: true, title: true, textContent: true },
    });
    if (!row) return;
    const signal = AbortSignal.timeout(60000);
    try {
      const chunks = chunkDocument(
        sourceFile(row.id),
        asMarkdown(row.title, row.textContent),
      );
      const vectors: number[][] = [];
      for (let offset = 0; offset < chunks.length; offset += 16) {
        const batch = chunks.slice(offset, offset + 16);
        const values = await abortable(
          this.embedding.embed(
            batch.map((c) => `${c.title}\n${c.heading}\n${c.text}`),
            'RETRIEVAL_DOCUMENT',
            signal,
          ),
          signal,
        );
        if (values.length !== batch.length)
          throw new Error('Invalid embedding count');
        vectors.push(...values.map((value) => normalizeVector(value)));
      }
      signal.throwIfAborted();
      await this.repo.update(
        { id: job.id, jobToken: job.token, status: 'processing' },
        {
          status: 'ready',
          error: null,
          chunkCount: chunks.length,
          embeddingData: {
            model: RAG_MODEL,
            dimensions: RAG_DIMENSIONS,
            chunkIds: chunks.map((c) => c.id),
            vectors,
          },
        },
      );
    } catch {
      this.logger.warn(
        `Document ${job.id} could not be indexed; content and API error details were withheld.`,
      );
      await this.repo.update(
        { id: job.id, jobToken: job.token, status: 'processing' },
        {
          status: 'failed',
          error:
            'Chưa tạo được dữ liệu tìm kiếm. Kiểm tra kết nối hoặc hạn mức dịch vụ AI rồi thử lại.',
        },
      );
    }
  }

  async sources(): Promise<AdditionalDocument[]> {
    const rows = await this.repo.find({
      where: { status: 'ready' },
      order: { id: 'ASC' },
      select: { id: true, title: true, textContent: true, embeddingData: true },
    });
    const sources: AdditionalDocument[] = [];
    for (const row of rows) {
      const data = row.embeddingData;
      if (
        !data ||
        data.model !== RAG_MODEL ||
        data.dimensions !== RAG_DIMENSIONS
      )
        continue;
      const markdown = asMarkdown(row.title, row.textContent);
      const chunks = chunkDocument(sourceFile(row.id), markdown);
      if (
        data.vectors.length !== chunks.length ||
        data.chunkIds.length !== chunks.length ||
        chunks.some((c, i) => c.id !== data.chunkIds[i])
      )
        continue;
      try {
        sources.push({
          file: sourceFile(row.id),
          markdown,
          vectors: Object.fromEntries(
            chunks.map((c, i) => [c.id, normalizeVector(data.vectors[i])]),
          ),
        });
      } catch {
        this.logger.warn(
          `Document ${row.id} contains an invalid search index and was skipped.`,
        );
      }
    }
    return sources;
  }
}
