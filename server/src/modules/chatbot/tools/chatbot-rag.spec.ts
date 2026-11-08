import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHATBOT_SEARCHABLE_DOCS,
  ChatbotRagIndex,
  chunkDocument,
  loadCorpus,
  normalizeVector,
  RAG_DIMENSIONS,
} from './chatbot-rag';

const vector = (axis: number) =>
  Array.from({ length: RAG_DIMENSIONS }, (_, i) => (i === axis ? 3 : 0));
describe('Chatbot RAG', () => {
  let dir: string;
  let docsDir: string;
  let indexPath: string;
  let embed: jest.Mock<Promise<number[][]>, [string[], string, AbortSignal]>;
  const create = (extra: Record<string, unknown> = {}) =>
    new ChatbotRagIndex({ docsDir, indexPath, embed, ...extra });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatbot-rag-test-'));
    docsDir = join(dir, 'docs');
    indexPath = join(dir, 'cache', 'index.json');
    await mkdir(docsDir);
    await writeFile(
      join(docsDir, 'BUSINESS_RULES.md'),
      '# Quy tắc\n## Quạt\nQuạt nhận lệnh bật hoặc tắt.\n## Ca trực\nNhân viên phải được duyệt ca.',
    );
    embed = jest
      .fn<Promise<number[][]>, [string[], string, AbortSignal]>()
      .mockImplementation((texts, task) =>
        Promise.resolve(
          texts.map((text) =>
            vector(
              task === 'RETRIEVAL_QUERY' || text.includes('Quạt nhận') ? 0 : 1,
            ),
          ),
        ),
      );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('indexes only the three public guides, never engineering docs or env files', async () => {
    await writeFile(
      join(docsDir, 'ARCHITECTURE.md'),
      '# Private\nsecret-schema',
    );
    await writeFile(join(docsDir, '.env'), 'secret-key');
    const corpus = await loadCorpus(docsDir);
    expect(CHATBOT_SEARCHABLE_DOCS).toHaveLength(3);
    expect(corpus.chunks.every((c) => c.file === 'BUSINESS_RULES.md')).toBe(
      true,
    );
    expect(JSON.stringify(corpus)).not.toContain('secret');
    expect(corpus.missing).toEqual([
      'SYSTEM_OPERATIONS_GUIDE.md',
      'TROUBLESHOOTING.md',
    ]);
  });

  it('normalizes CRLF before fingerprinting and records changed content', async () => {
    const path = join(docsDir, 'BUSINESS_RULES.md');
    const original = await readFile(path, 'utf8');
    const before = await loadCorpus(docsDir);
    await writeFile(path, original.replace(/\n/g, '\r\n'));
    expect((await loadCorpus(docsDir)).fingerprint).toBe(before.fingerprint);
    await writeFile(path, original + '\nCập nhật');
    expect((await loadCorpus(docsDir)).fingerprint).not.toBe(
      before.fingerprint,
    );
  });

  it('bounds chunks, overlaps long sections and retains heading provenance', () => {
    const chunks = chunkDocument(
      'guide.md',
      '# Hướng dẫn\n## Phần một\n' +
        'x'.repeat(2600) +
        '\n## Phần hai\nNội dung khác',
    );
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.text.length <= 1200)).toBe(true);
    expect(chunks[0].text.slice(-180)).toBe(chunks[1].text.slice(0, 180));
    expect(chunks[3].heading).toBe('Hướng dẫn > Phần hai');
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it('uses semantic vectors for a paraphrase absent from the document', async () => {
    const result = await create().search('Có thể ngừng bộ làm mát từ xa chứ?');
    expect(result.method).toBe('semantic');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      heading: 'Quy tắc > Quạt',
      score: 1,
    });
    expect(result.matches[0].citation).toContain('Quạt');
    expect(embed.mock.calls.map((call) => call[1])).toEqual([
      'RETRIEVAL_DOCUMENT',
      'RETRIEVAL_QUERY',
    ]);
  });

  it('normalizes both query and document vectors and caches repeated query embeddings', async () => {
    const index = create();
    await index.search('tắt quạt');
    await index.search('tắt quạt');
    expect(embed).toHaveBeenCalledTimes(2);
    const saved = JSON.parse(await readFile(indexPath, 'utf8')) as {
      vectors: number[][];
      model: string;
      dimensions: number;
      ids: string[];
    };
    expect(saved.vectors[0][0]).toBe(1);
  });

  it('loads valid persisted document embeddings across restarts', async () => {
    await create().search('tắt quạt');
    embed.mockClear();
    await create().search('dừng quạt');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][1]).toBe('RETRIEVAL_QUERY');
  });

  it('rebuilds after editing docs instead of pairing old vectors with new text', async () => {
    const index = create();
    await index.search('tắt quạt');
    await writeFile(
      join(docsDir, 'BUSINESS_RULES.md'),
      '# Quy tắc\n## Mới\nQuạt nhận lệnh mới.',
    );
    const result = await index.search('tắt quạt');
    expect(result.matches[0].heading).toBe('Quy tắc > Mới');
    expect(
      embed.mock.calls.filter((c) => c[1] === 'RETRIEVAL_DOCUMENT'),
    ).toHaveLength(2);
  });

  it.each([
    'wrong model',
    'wrong dimension',
    'invalid vector',
    'wrong ids',
    'malformed json',
  ])('rejects a cache with %s', async (kind) => {
    await create().search('quạt');
    const saved = JSON.parse(await readFile(indexPath, 'utf8')) as {
      vectors: number[][];
      model: string;
      dimensions: number;
      ids: string[];
    };
    if (kind === 'wrong model') saved.model = 'another-model';
    if (kind === 'wrong dimension') saved.dimensions = 2;
    if (kind === 'invalid vector') saved.vectors[0] = [1];
    if (kind === 'wrong ids') saved.ids[0] = 'fake';
    await writeFile(
      indexPath,
      kind === 'malformed json' ? '{broken' : JSON.stringify(saved),
    );
    embed.mockClear();
    expect((await create().search('quạt')).method).toBe('semantic');
    expect(embed.mock.calls.some((c) => c[1] === 'RETRIEVAL_DOCUMENT')).toBe(
      true,
    );
  });

  it('shares an index build between concurrent searches', async () => {
    const index = create();
    await Promise.all([index.search('quạt'), index.search('ca trực')]);
    expect(
      embed.mock.calls.filter((c) => c[1] === 'RETRIEVAL_DOCUMENT'),
    ).toHaveLength(1);
  });

  it('marks keyword fallback explicitly on API failure and cools down retries', async () => {
    embed.mockRejectedValue(new Error('quota'));
    const index = create();
    const result = await index.search('quạt');
    expect(result.method).toBe('keyword_fallback');
    expect(result.warning).toBeTruthy();
    expect(result.matches[0].heading).toContain('Quạt');
    await index.search('quạt');
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('does not accept an incorrect number of document embeddings', async () => {
    embed.mockResolvedValue([vector(0)]);
    expect((await create().search('quạt')).method).toBe('keyword_fallback');
    await expect(readFile(indexPath)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('honors cancellation even when the provider ignores abort', async () => {
    const index = create();
    await index.search('warm up');
    embed.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const result = index.search('cancel me', controller.signal);
    controller.abort(new Error('test cancelled'));
    await expect(result).rejects.toThrow('test cancelled');
  });

  it('bounds a stalled embedding and reports fallback instead of hanging a turn', async () => {
    embed.mockImplementation(() => new Promise(() => undefined));
    const result = await create({ timeoutMs: 100 }).search('quạt');
    expect(result.method).toBe('keyword_fallback');
  });

  it('returns unavailable without an API call for an empty corpus', async () => {
    await writeFile(join(docsDir, 'BUSINESS_RULES.md'), '');
    expect((await create().search('quạt')).method).toBe('unavailable');
    expect(embed).not.toHaveBeenCalled();
  });

  it('does not fill results with chunks below the minimum similarity', async () => {
    embed.mockImplementation((texts, task) =>
      Promise.resolve(
        texts.map(() => vector(task === 'RETRIEVAL_QUERY' ? 2 : 0)),
      ),
    );
    expect((await create().search('unrelated')).matches).toEqual([]);
  });

  it('enforces top-k and configuration limits', async () => {
    expect(
      (await create({ topK: 1, minScore: 0 }).search('quạt')).matches,
    ).toHaveLength(1);
    expect(() => create({ topK: 100 })).toThrow();
    expect(() => create({ minScore: NaN })).toThrow();
    expect(() => create({ timeoutMs: -1 })).toThrow();
  });

  it('rejects non-finite, zero and wrong-size vectors', () => {
    expect(() => normalizeVector([1])).toThrow();
    expect(() =>
      normalizeVector(Array<number>(RAG_DIMENSIONS).fill(0)),
    ).toThrow();
    expect(() =>
      normalizeVector(Array<number>(RAG_DIMENSIONS).fill(Infinity)),
    ).toThrow();
  });

  it('continues with an in-memory index when the disk cache cannot be written', async () => {
    const index = create({ indexPath: docsDir });
    expect((await index.search('quạt')).method).toBe('semantic');
    await index.search('quạt');
    expect(embed).toHaveBeenCalledTimes(2);
  });
  it('uses ready uploaded vectors without re-embedding them and invalidates deleted sources', async () => {
    const file = 'uploaded/cccccccc-cccc-4ccc-8ccc-cccccccccccc.md';
    const markdown = '# Quy trình bổ sung\nQuạt nhận hướng dẫn mở rộng.';
    const parts = chunkDocument(file, markdown);
    const source = {
      file,
      markdown,
      vectors: Object.fromEntries(parts.map((c) => [c.id, vector(0)])),
    };
    const sources = [source];
    const index = create({ loadSources: () => Promise.resolve(sources) });
    const first = await index.search('quạt');
    expect(first.matches.some((m) => m.file === file)).toBe(true);
    const docCalls = embed.mock.calls.filter(
      (c) => c[1] === 'RETRIEVAL_DOCUMENT',
    );
    expect(docCalls[0][0].some((t) => t.includes('Quy trình bổ sung'))).toBe(
      false,
    );
    sources.splice(0);
    const second = await index.search('quạt');
    expect(second.matches.some((m) => m.file === file)).toBe(false);
    expect(
      embed.mock.calls.filter((c) => c[1] === 'RETRIEVAL_DOCUMENT'),
    ).toHaveLength(1);
  });

  it('only embeds new chunks after adding a managed source', async () => {
    const sources: { file: string; markdown: string }[] = [];
    const index = create({ loadSources: () => Promise.resolve(sources) });
    await index.search('quạt');
    sources.push({
      file: 'uploaded/cccccccc-cccc-4ccc-8ccc-cccccccccccc.md',
      markdown: '# Bổ sung\nQuạt nhận thêm hướng dẫn mới.',
    });
    await index.search('quạt');
    const calls = embed.mock.calls.filter((c) => c[1] === 'RETRIEVAL_DOCUMENT');
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toHaveLength(1);
  });

  it('rejects arbitrary disk paths as managed sources', async () => {
    await expect(
      loadCorpus(docsDir, [{ file: '../.env', markdown: 'secret' }]),
    ).rejects.toThrow('Invalid managed document id');
  });
});
