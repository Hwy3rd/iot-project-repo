import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Only public operator guides may enter the embedding API or model context.
export const CHATBOT_SEARCHABLE_DOCS = [
  'BUSINESS_RULES.md',
  'SYSTEM_OPERATIONS_GUIDE.md',
  'TROUBLESHOOTING.md',
] as const;
export const RAG_MODEL = 'gemini-embedding-001';
export const RAG_DIMENSIONS = 768;
const SCHEMA = 'chatbot-rag-v1-1200-180';
const MAX_DOCUMENT_CHARS = 100_000;
const MAX_CHUNKS = 300;
const CHUNK_SIZE = 1200;
const OVERLAP = 180;

export interface DocChunk {
  id: string;
  file: string;
  title: string;
  heading: string;
  text: string;
}
export interface AdditionalDocument {
  file: string;
  markdown: string;
  vectors?: Record<string, number[]>;
}
export interface Corpus {
  fingerprint: string;
  suppliedVectors: Record<string, number[]>;
  chunks: DocChunk[];
  missing: string[];
}
export interface DocMatch extends DocChunk {
  score: number;
  citation: string;
}
export interface RetrievalResult {
  method: 'semantic' | 'keyword_fallback' | 'unavailable';
  matches: DocMatch[];
  warning?: string;
  missingDocuments: string[];
}
export type Embedder = (
  texts: string[],
  task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  signal: AbortSignal,
) => Promise<number[][]>;
interface VectorIndex {
  schema: string;
  model: string;
  dimensions: number;
  fingerprint: string;
  ids: string[];
  vectors: number[][];
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// Keep each chunk within a section; overlap prevents losing boundary context.
export function chunkDocument(file: string, markdown: string): DocChunk[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const title =
    lines
      .find((line) => /^# /.test(line))
      ?.slice(2)
      .trim() || file;
  const chunks: DocChunk[] = [];
  const headings: string[] = [];
  let body: string[] = [];
  let heading = title;
  const flush = () => {
    const text = body.join('\n').trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + CHUNK_SIZE, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf('\n', end);
        if (boundary > start + CHUNK_SIZE / 2) end = boundary;
      }
      const part = text.slice(start, end).trim();
      if (part)
        chunks.push({
          id: hash(`${file}\n${heading}\n${start}\n${part}`).slice(0, 24),
          file,
          title,
          heading,
          text: part,
        });
      if (end === text.length) break;
      start = end - OVERLAP;
    }
    body = [];
  };
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) {
      body.push(line);
      continue;
    }
    flush();
    const level = match[1].length;
    headings.length = level - 1;
    headings[level - 1] = match[2].trim();
    heading = headings.filter(Boolean).join(' > ');
  }
  flush();
  return chunks;
}

export async function loadCorpus(
  docsDir: string,
  additional: AdditionalDocument[] = [],
): Promise<Corpus> {
  const chunks: DocChunk[] = [];
  const missing: string[] = [];
  const sources: string[] = [];
  for (const file of CHATBOT_SEARCHABLE_DOCS) {
    let text: string;
    try {
      text = (await readFile(join(docsDir, file), 'utf8')).replace(
        /\r\n?/g,
        '\n',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.push(file);
      continue;
    }
    if (text.length > MAX_DOCUMENT_CHARS)
      throw new Error('Document exceeds RAG size limit');
    if (!text.trim()) {
      missing.push(file);
      continue;
    }
    sources.push(`${file}\n${text}`);
    chunks.push(...chunkDocument(file, text));
  }
  const suppliedVectors: Record<string, number[]> = {};
  const seen = new Set<string>();
  for (const document of additional) {
    if (
      !/^uploaded\/[0-9a-f-]{36}\.md$/i.test(document.file) ||
      seen.has(document.file)
    )
      throw new Error('Invalid managed document id');
    seen.add(document.file);
    const text = document.markdown.replace(/\r\n?/g, '\n');
    if (text.length > MAX_DOCUMENT_CHARS)
      throw new Error('Document exceeds RAG size limit');
    const parts = chunkDocument(document.file, text);
    sources.push(`${document.file}\n${text}`);
    chunks.push(...parts);
    for (const chunk of parts) {
      const vector = document.vectors?.[chunk.id];
      if (vector) suppliedVectors[chunk.id] = normalizeVector(vector);
    }
  }
  if (chunks.length > MAX_CHUNKS)
    throw new Error('Corpus exceeds RAG chunk limit');
  return {
    chunks,
    suppliedVectors,
    missing,
    fingerprint: hash(
      `${SCHEMA}\n${RAG_MODEL}\n${RAG_DIMENSIONS}\n${sources.join('\n')}`,
    ),
  };
}

export function normalizeVector(
  values: number[],
  dimensions = RAG_DIMENSIONS,
): number[] {
  if (
    !Array.isArray(values) ||
    values.length !== dimensions ||
    !values.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    throw new Error('Invalid embedding dimensions or values');
  }
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error('Invalid zero embedding');
  return values.map((v) => v / norm);
}

function match(chunk: DocChunk, score: number): DocMatch {
  return { ...chunk, score, citation: `${chunk.title} — ${chunk.heading}` };
}
function tokens(text: string): string[] {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  );
}
function keywordSearch(
  corpus: Corpus,
  query: string,
  topK: number,
): DocMatch[] {
  const terms = [...new Set(tokens(query))].filter((term) => term.length > 2);
  if (!terms.length) return [];
  return corpus.chunks
    .map((chunk) => {
      const bag = new Set(tokens(`${chunk.heading}\n${chunk.text}`));
      return match(
        chunk,
        terms.filter((term) => bag.has(term)).length / terms.length,
      );
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Await cancellation even if an SDK/network mock ignores its abort signal.
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Aborted'),
      );
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export class ChatbotRagIndex {
  private index?: VectorIndex;
  private building?: Promise<VectorIndex>;
  private buildingFingerprint?: string;
  private retryAfter = 0;
  private queryCache = new Map<string, { vector: number[]; expires: number }>();
  constructor(
    private readonly options: {
      docsDir: string;
      loadSources?: () => Promise<AdditionalDocument[]>;
      indexPath: string;
      embed: Embedder;
      topK?: number;
      minScore?: number;
      timeoutMs?: number;
      onWarning?: (message: string) => void;
    },
  ) {
    if (
      options.topK !== undefined &&
      (!Number.isInteger(options.topK) || options.topK < 1 || options.topK > 8)
    )
      throw new Error('RAG topK must be 1..8');
    if (
      options.minScore !== undefined &&
      (!Number.isFinite(options.minScore) ||
        options.minScore < 0 ||
        options.minScore > 1)
    )
      throw new Error('RAG minScore must be 0..1');
    if (
      options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 100 ||
        options.timeoutMs > 60_000)
    )
      throw new Error('RAG timeout must be 100..60000 ms');
  }

  async prepare(): Promise<{
    method: 'semantic';
    chunks: number;
    missingDocuments: string[];
    fingerprint: string;
  }> {
    const corpus = await loadCorpus(
      this.options.docsDir,
      await this.options.loadSources?.(),
    );
    if (!corpus.chunks.length) throw new Error('No public documents to index');
    await this.ensureIndex(corpus);
    return {
      method: 'semantic',
      chunks: corpus.chunks.length,
      missingDocuments: corpus.missing,
      fingerprint: corpus.fingerprint,
    };
  }

  async search(
    query: string,
    callerSignal?: AbortSignal,
  ): Promise<RetrievalResult> {
    const signal = callerSignal
      ? AbortSignal.any([
          callerSignal,
          AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
        ])
      : AbortSignal.timeout(this.options.timeoutMs ?? 20_000);
    signal.throwIfAborted();
    query = query.trim().slice(0, 2000);
    if (!query)
      return { method: 'unavailable', matches: [], missingDocuments: [] };
    const corpus = await abortable(
      loadCorpus(this.options.docsDir, await this.options.loadSources?.()),
      signal,
    );
    if (!corpus.chunks.length)
      return {
        method: 'unavailable',
        matches: [],
        missingDocuments: corpus.missing,
        warning: 'Không có tài liệu nghiệp vụ để tra cứu.',
      };
    const topK = this.options.topK ?? 4;
    try {
      if (Date.now() < this.retryAfter) throw new Error('Embedding cooldown');
      const index = await abortable(this.ensureIndex(corpus), signal);
      const cached = this.queryCache.get(query);
      let vector =
        cached && cached.expires > Date.now() ? cached.vector : undefined;
      if (!vector) {
        const vectors = await abortable(
          this.options.embed([query], 'RETRIEVAL_QUERY', signal),
          signal,
        );
        if (vectors.length !== 1)
          throw new Error('Invalid query embedding count');
        vector = normalizeVector(vectors[0]);
        signal.throwIfAborted();
        if (this.queryCache.size >= 100) {
          const oldest = this.queryCache.keys().next();
          if (!oldest.done) this.queryCache.delete(oldest.value);
        }
        this.queryCache.set(query, { vector, expires: Date.now() + 300_000 });
      }
      const queryVector = vector;
      const matches = corpus.chunks
        .map((chunk, i) =>
          match(
            chunk,
            index.vectors[i].reduce(
              (score, value, j) => score + value * queryVector[j],
              0,
            ),
          ),
        )
        .filter((item) => item.score >= (this.options.minScore ?? 0.45))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { method: 'semantic', matches, missingDocuments: corpus.missing };
    } catch {
      callerSignal?.throwIfAborted();
      this.retryAfter = Date.now() + 60_000;
      this.options.onWarning?.(
        'Semantic retrieval unavailable; using keyword fallback for 60 seconds.',
      );
      return {
        method: 'keyword_fallback',
        matches: keywordSearch(corpus, query, topK),
        missingDocuments: corpus.missing,
        warning:
          'Tìm kiếm ngữ nghĩa tạm không khả dụng; kết quả dưới đây chỉ được tìm theo từ khóa, có thể thiếu thông tin.',
      };
    }
  }

  private async ensureIndex(corpus: Corpus): Promise<VectorIndex> {
    if (this.index?.fingerprint === corpus.fingerprint) return this.index;
    if (this.building) {
      if (this.buildingFingerprint === corpus.fingerprint) return this.building;
      // A document edit during a build must never pair new text with old vectors.
      await this.building.catch(() => undefined);
      return this.ensureIndex(corpus);
    }
    this.buildingFingerprint = corpus.fingerprint;
    this.building = this.loadOrBuild(corpus);
    try {
      this.index = await this.building;
      return this.index;
    } finally {
      this.building = undefined;
      this.buildingFingerprint = undefined;
    }
  }

  private async loadOrBuild(corpus: Corpus): Promise<VectorIndex> {
    const reusable = new Map<string, number[]>();
    try {
      const saved = JSON.parse(
        await readFile(this.options.indexPath, 'utf8'),
      ) as VectorIndex;
      if (
        saved.schema === SCHEMA &&
        saved.model === RAG_MODEL &&
        saved.dimensions === RAG_DIMENSIONS &&
        saved.ids.length === saved.vectors.length
      ) {
        const normalized = saved.vectors.map((v) => normalizeVector(v));
        saved.ids.forEach((id, i) => reusable.set(id, normalized[i]));
      }
      if (
        saved.schema === SCHEMA &&
        saved.model === RAG_MODEL &&
        saved.dimensions === RAG_DIMENSIONS &&
        saved.fingerprint === corpus.fingerprint &&
        saved.ids.length === corpus.chunks.length &&
        saved.ids.every((id, i) => id === corpus.chunks[i].id) &&
        saved.vectors.length === corpus.chunks.length
      ) {
        return {
          ...saved,
          vectors: saved.vectors.map((v) => normalizeVector(v)),
        };
      }
    } catch {
      /* Missing, malformed or outdated cache is rebuilt from allowed docs. */
    }
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 20_000);
    for (const [id, vector] of Object.entries(corpus.suppliedVectors))
      reusable.set(id, vector);
    const missing = corpus.chunks.filter((chunk) => !reusable.has(chunk.id));
    for (let offset = 0; offset < missing.length; offset += 16) {
      const batch = missing.slice(offset, offset + 16);
      const values = await abortable(
        this.options.embed(
          batch.map(
            (chunk) => `${chunk.title}\n${chunk.heading}\n${chunk.text}`,
          ),
          'RETRIEVAL_DOCUMENT',
          signal,
        ),
        signal,
      );
      if (values.length !== batch.length)
        throw new Error('Invalid document embedding count');
      batch.forEach((chunk, i) =>
        reusable.set(chunk.id, normalizeVector(values[i])),
      );
    }
    const vectors = corpus.chunks.map((chunk) => {
      const vector = reusable.get(chunk.id);
      if (!vector) throw new Error('Missing embedding');
      return vector;
    });
    signal.throwIfAborted();
    const index: VectorIndex = {
      schema: SCHEMA,
      model: RAG_MODEL,
      dimensions: RAG_DIMENSIONS,
      fingerprint: corpus.fingerprint,
      ids: corpus.chunks.map((c) => c.id),
      vectors,
    };
    const temporary = `${this.options.indexPath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.options.indexPath), { recursive: true });
      await writeFile(temporary, JSON.stringify(index), {
        encoding: 'utf8',
        mode: 0o600,
      });
      signal.throwIfAborted();
      await rename(temporary, this.options.indexPath);
    } catch {
      this.options.onWarning?.(
        'RAG cache could not be saved; this process will use its in-memory index.',
      );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    signal.throwIfAborted();
    return index;
  }
}
