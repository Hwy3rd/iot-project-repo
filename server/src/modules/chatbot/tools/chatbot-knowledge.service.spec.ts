import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatbotKnowledgeService } from './chatbot-knowledge.service';

describe('ChatbotKnowledgeService modes', () => {
  let dir: string;
  let embedContent: jest.Mock;
  const create = (mode: string) =>
    new ChatbotKnowledgeService(
      { models: { embedContent } } as never,
      new ConfigService({
        CHATBOT_KNOWLEDGE_MODE: mode,
        CHATBOT_DOCS_DIR: dir,
        CHATBOT_RAG_INDEX_PATH: join(dir, 'index.json'),
      }),
    );
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatbot-knowledge-test-'));
    await writeFile(
      join(dir, 'BUSINESS_RULES.md'),
      '# Quy tắc\n## Phân quyền\nManager không gửi lệnh quạt.',
    );
    embedContent = jest.fn();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('none neither reads knowledge into context nor exposes semantic retrieval', async () => {
    const service = create('none');
    expect(await service.context('quạt')).toBe('');
    expect((await service.search('quạt')).method).toBe('unavailable');
    expect(embedContent).not.toHaveBeenCalled();
  });
  it('prompt uses the same reviewed documents without calling embeddings', async () => {
    const service = create('prompt');
    const context = JSON.parse(await service.context('quạt')) as {
      method: string;
      text?: string;
    };
    expect(context.method).toBe('full_documents');
    expect(context.text).toContain('Manager không gửi lệnh quạt');
    expect((await service.search('quạt')).method).toBe('unavailable');
    expect(embedContent).not.toHaveBeenCalled();
  });
  it('does not pretend retrieval is semantic when the key is missing', async () => {
    const service = create('rag');
    const context = JSON.parse(await service.context('quạt')) as {
      method: string;
      text?: string;
    };
    expect(context.method).toBe('keyword_fallback');
    expect(embedContent).not.toHaveBeenCalled();
  });
  it('defaults to rag and rejects invalid modes', () => {
    expect(create('').mode).toBe('rag');
    expect(() => create('pretend-rag')).toThrow(
      'Invalid CHATBOT_KNOWLEDGE_MODE',
    );
  });
});
