import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatbotDocumentsService,
  MAX_UPLOAD_DOCUMENTS,
} from './chatbot-documents.service';
import { ChatbotDocument } from './chatbot-document.entity';
import { chunkDocument, RAG_DIMENSIONS, RAG_MODEL } from '../tools/chatbot-rag';

const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TEXT = 'Quản lý chỉ xem lệnh. Kỹ thuật viên được gửi lệnh quạt.';
const vec = () =>
  Array.from({ length: RAG_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const row = () =>
  ({
    id: ID,
    title: 'Hướng dẫn',
    filename: 'guide.md',
    textContent: TEXT,
    status: 'pending',
    chunkCount: 1,
    error: null,
  }) as ChatbotDocument;

describe('ChatbotDocumentsService', () => {
  let service: ChatbotDocumentsService;
  let repo: {
    find: jest.Mock<Promise<ChatbotDocument[]>, [unknown?]>;
    findOne: jest.Mock<Promise<ChatbotDocument | null>, [unknown]>;
    update: jest.Mock<Promise<{ affected: number }>, [unknown, unknown]>;
    delete: jest.Mock<Promise<{ affected: number }>, [unknown]>;
    create: jest.Mock<ChatbotDocument, [Partial<ChatbotDocument>]>;
    save: jest.Mock<Promise<ChatbotDocument>, [ChatbotDocument]>;
  };
  let queue: { add: jest.Mock };
  let embedding: {
    available: boolean;
    embed: jest.Mock<Promise<number[][]>, [string[], string, AbortSignal]>;
  };
  const uploadFile = {
    buffer: Buffer.from(TEXT),
    originalname: 'guide.md',
  } as Express.Multer.File;
  beforeEach(() => {
    repo = {
      find: jest
        .fn<Promise<ChatbotDocument[]>, [unknown?]>()
        .mockResolvedValue([]),
      findOne: jest
        .fn<Promise<ChatbotDocument | null>, [unknown]>()
        .mockResolvedValue(row()),
      update: jest
        .fn<Promise<{ affected: number }>, [unknown, unknown]>()
        .mockResolvedValue({ affected: 1 }),
      delete: jest
        .fn<Promise<{ affected: number }>, [unknown]>()
        .mockResolvedValue({ affected: 1 }),
      create: jest.fn((value) => value as ChatbotDocument),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    embedding = {
      available: true,
      embed: jest
        .fn<Promise<number[][]>, [string[], string, AbortSignal]>()
        .mockImplementation((texts) => Promise.resolve(texts.map(() => vec()))),
    };
    service = new ChatbotDocumentsService(
      repo as never,
      queue as never,
      {
        read: jest.fn().mockResolvedValue({
          text: TEXT,
          filename: 'guide.md',
          mimeType: 'text/plain',
          pages: null,
        }),
      },
      embedding,
      new ConfigService(),
    );
  });

  it('saves an upload as pending without spending an embedding request', async () => {
    const result = await service.upload(uploadFile, 'Hướng dẫn', 'admin1');
    expect(result.status).toBe('pending');
    expect(result.textContent).toBe(TEXT);
    expect(queue.add).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });
  it('rejects missing files, empty titles and a full collection', async () => {
    await expect(
      service.upload(undefined, 'Hướng dẫn', 'admin1'),
    ).rejects.toThrow(BadRequestException);
    await expect(service.upload(uploadFile, '  ', 'admin1')).rejects.toThrow(
      BadRequestException,
    );
    repo.find.mockResolvedValue(
      Array.from({ length: MAX_UPLOAD_DOCUMENTS }, row),
    );
    await expect(
      service.upload(uploadFile, 'Hướng dẫn', 'admin1'),
    ).rejects.toThrow('giới hạn');
  });
  it('reports duplicate content without exposing a database error', async () => {
    repo.save.mockRejectedValue({ driverError: { code: 'ER_DUP_ENTRY' } });
    await expect(
      service.upload(uploadFile, 'Hướng dẫn', 'admin1'),
    ).rejects.toThrow(ConflictException);
  });
  it('requires an explicitly configured API before queueing a paid operation', async () => {
    embedding.available = false;
    await expect(service.enqueue(ID)).rejects.toThrow('Chưa cấu hình');
    expect(queue.add).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('atomically prevents concurrent processing requests for the same document', async () => {
    repo.update.mockResolvedValue({ affected: 0 });
    await expect(service.enqueue(ID)).rejects.toThrow(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('queues only the document id and token, not its text or vector data', async () => {
    await service.enqueue(ID);
    expect(queue.add).toHaveBeenCalledWith(
      'index-document',
      { id: ID, token: expect.any(String) as unknown },
      expect.objectContaining({ attempts: 1 }),
    );
    expect(JSON.stringify(queue.add.mock.calls)).not.toContain(TEXT);
  });
  it('makes queue failure visible and retryable', async () => {
    queue.add.mockRejectedValue(new Error('private connection details'));
    await expect(service.enqueue(ID)).rejects.toThrow('Không kết nối được');
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ID }),
      expect.objectContaining({ status: 'failed' }),
    );
  });
  it('publishes only validated embeddings for the current processing token', async () => {
    await service.process({ id: ID, token: TOKEN });
    expect(embedding.embed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining(TEXT)]),
      'RETRIEVAL_DOCUMENT',
      expect.any(AbortSignal),
    );
    expect(repo.update).toHaveBeenLastCalledWith(
      { id: ID, jobToken: TOKEN, status: 'processing' },
      expect.objectContaining({
        status: 'ready',
        embeddingData: expect.objectContaining({
          model: RAG_MODEL,
          dimensions: RAG_DIMENSIONS,
        }) as unknown,
      }),
    );
  });
  it('does not embed a deleted or superseded document job', async () => {
    repo.update.mockResolvedValue({ affected: 0 });
    await service.process({ id: ID, token: TOKEN });
    expect(embedding.embed).not.toHaveBeenCalled();
  });
  it('does not publish invalid vectors or leak provider errors', async () => {
    embedding.embed.mockResolvedValue([[1, 2]]);
    await service.process({ id: ID, token: TOKEN });
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ID, jobToken: TOKEN }),
      expect.objectContaining({ status: 'failed' }),
    );
    embedding.embed.mockRejectedValue(new Error('secret API key payload'));
    await service.process({ id: ID, token: TOKEN });
    expect(JSON.stringify(repo.update.mock.calls)).not.toContain('secret API');
  });
  it('returns only complete ready documents with matching vector provenance', async () => {
    const document = row();
    const markdown = `# ${document.title}\n\n${document.textContent}`;
    const chunks = chunkDocument(`uploaded/${ID}.md`, markdown);
    document.status = 'ready';
    document.embeddingData = {
      model: RAG_MODEL,
      dimensions: RAG_DIMENSIONS,
      chunkIds: chunks.map((c) => c.id),
      vectors: chunks.map(() => vec()),
    };
    repo.find.mockResolvedValue([document]);
    const result = await service.sources();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ready' } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].markdown).toContain(TEXT);
    document.embeddingData.chunkIds[0] = 'wrong-source';
    expect(await service.sources()).toEqual([]);
  });
  it('excludes a document whose model or vector dimensions are invalid', async () => {
    const document = row();
    document.embeddingData = {
      model: 'old-model',
      dimensions: 3,
      chunkIds: [],
      vectors: [],
    };
    repo.find.mockResolvedValue([document]);
    expect(await service.sources()).toEqual([]);
  });
  it('blocks path traversal and requests for engineering guides', async () => {
    await expect(service.builtin('../.env')).rejects.toThrow(NotFoundException);
    await expect(service.builtin('DATABASE_DESIGN.md')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('reports a missing document on detail and deletion', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.detail(ID)).rejects.toThrow(NotFoundException);
    repo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.remove(ID)).rejects.toThrow(NotFoundException);
  });
});
