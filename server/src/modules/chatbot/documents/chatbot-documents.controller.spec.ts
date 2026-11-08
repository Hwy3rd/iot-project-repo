import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { Server } from 'node:http';
import request from 'supertest';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';
import { UserRole } from '../../../libs/constants/user.constant';
import { ChatbotDocumentsController } from './chatbot-documents.controller';
import { ChatbotDocumentsService } from './chatbot-documents.service';

jest.mock('./chatbot-documents.service', () => ({
  ChatbotDocumentsService: jest.fn(),
}));
const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
describe('Chatbot document HTTP permissions and serialization', () => {
  let app: INestApplication;
  const document = {
    id: ID,
    title: 'Hướng dẫn',
    filename: 'guide.md',
    mimeType: 'text/plain',
    bytes: 100,
    pages: null,
    status: 'pending',
    chunkCount: 1,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    textContent: 'Nội dung hướng dẫn cho người vận hành.',
    embeddingData: { secretVector: [1, 2] },
    jobToken: 'private-token',
    contentHash: 'private-hash',
  };
  const service = {
    overview: jest.fn().mockResolvedValue({
      items: [document],
      builtins: [],
      processingAvailable: false,
      knowledgeMode: 'rag',
      maxDocuments: 30,
    }),
    detail: jest.fn().mockResolvedValue(document),
    builtin: jest.fn(),
    upload: jest.fn().mockResolvedValue(document),
    enqueue: jest.fn().mockResolvedValue(document),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChatbotDocumentsController],
      providers: [{ provide: ChatbotDocumentsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    // Only this isolated test server accepts a header as its caller; production uses its JWT guard.
    app.use(
      (
        req: {
          headers: Record<string, string | undefined>;
          user?: { id: string; role: string };
        },
        _res: unknown,
        next: () => void,
      ) => {
        if (req.headers['x-test-role'])
          req.user = { id: 'admin1', role: req.headers['x-test-role'] };
        next();
      },
    );
    app.useGlobalGuards(new RolesGuard(app.get(Reflector)));
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('requires a caller even for listing sources', async () => {
    await request(app.getHttpServer() as Server)
      .get('/chatbot/documents')
      .expect(401);
    expect(service.overview).not.toHaveBeenCalled();
  });
  it.each([UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.STAFF])(
    'denies %s access to every document management operation',
    async (role) => {
      const server = app.getHttpServer() as Server;
      await request(server)
        .get('/chatbot/documents')
        .set('x-test-role', role)
        .expect(403);
      await request(server)
        .post('/chatbot/documents')
        .set('x-test-role', role)
        .expect(403);
      await request(server)
        .post(`/chatbot/documents/${ID}/process`)
        .set('x-test-role', role)
        .expect(403);
      await request(server)
        .delete(`/chatbot/documents/${ID}`)
        .set('x-test-role', role)
        .expect(403);
      expect(service.overview).not.toHaveBeenCalled();
      expect(service.upload).not.toHaveBeenCalled();
    },
  );
  it('lists metadata but never text, vectors or job tokens', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/chatbot/documents')
      .set('x-test-role', 'admin')
      .expect(200);
    const body = response.body as {
      success: boolean;
      data: { items: Record<string, unknown>[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.items[0].title).toBe('Hướng dẫn');
    for (const key of [
      'textContent',
      'embeddingData',
      'jobToken',
      'contentHash',
    ])
      expect(body.data.items[0]).not.toHaveProperty(key);
  });
  it('allows Admin to preview text while stripping internal fields', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`/chatbot/documents/${ID}`)
      .set('x-test-role', 'admin')
      .expect(200);
    const body = response.body as { data: Record<string, unknown> };
    expect(body.data.textContent).toContain('Nội dung');
    expect(body.data).not.toHaveProperty('embeddingData');
  });
  it('accepts a multipart text upload from Admin and keeps the response lean', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/chatbot/documents')
      .set('x-test-role', 'admin')
      .field('title', 'Hướng dẫn')
      .attach('file', Buffer.from('Useful operating instructions'), 'guide.md')
      .expect(201);
    expect(service.upload).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'guide.md' }),
      'Hướng dẫn',
      'admin1',
    );
    const body = response.body as { data: Record<string, unknown> };
    expect(body.data.status).toBe('pending');
    expect(body.data).not.toHaveProperty('textContent');
    expect(service.enqueue).not.toHaveBeenCalled();
  });
  it('rejects unsupported files and invalid metadata before the service executes', async () => {
    const server = app.getHttpServer() as Server;
    await request(server)
      .post('/chatbot/documents')
      .set('x-test-role', 'admin')
      .field('title', 'Hướng dẫn')
      .attach('file', Buffer.from('binary'), 'bad.exe')
      .expect(400);
    await request(server)
      .post('/chatbot/documents')
      .set('x-test-role', 'admin')
      .field('title', 'x')
      .attach('file', Buffer.from('text'), 'guide.md')
      .expect(400);
    expect(service.upload).not.toHaveBeenCalled();
  });
  it('rejects non-UUID document ids and returns a JSON envelope on deletion', async () => {
    const server = app.getHttpServer() as Server;
    await request(server)
      .post('/chatbot/documents/bad-id/process')
      .set('x-test-role', 'admin')
      .expect(400);
    await request(server)
      .delete(`/chatbot/documents/${ID}`)
      .set('x-test-role', 'admin')
      .expect(200);
    expect(service.remove).toHaveBeenCalledWith(ID);
  });
});
