import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { join } from 'node:path';
import { LLM_CLIENT } from '../../../libs/llm/llm.constant';
import {
  ChatbotRagIndex,
  loadCorpus,
  RAG_DIMENSIONS,
  RAG_MODEL,
} from './chatbot-rag';

export type ChatbotKnowledgeMode = 'none' | 'prompt' | 'rag';

@Injectable()
export class ChatbotKnowledgeService {
  private readonly logger = new Logger(ChatbotKnowledgeService.name);
  readonly mode: ChatbotKnowledgeMode;
  private readonly docsDir: string;
  private readonly index: ChatbotRagIndex;

  constructor(@Inject(LLM_CLIENT) client: GoogleGenAI, config: ConfigService) {
    const mode = config.get<string>('CHATBOT_KNOWLEDGE_MODE') || 'rag';
    if (!['none', 'prompt', 'rag'].includes(mode))
      throw new Error('Invalid CHATBOT_KNOWLEDGE_MODE');
    this.mode = mode as ChatbotKnowledgeMode;
    this.docsDir =
      config.get<string>('CHATBOT_DOCS_DIR') ||
      join(process.cwd(), '..', 'docs');
    this.index = new ChatbotRagIndex({
      docsDir: this.docsDir,
      indexPath:
        config.get<string>('CHATBOT_RAG_INDEX_PATH') ||
        join(process.cwd(), '.cache', 'chatbot-rag', 'index.json'),
      topK: Number(config.get('CHATBOT_RAG_TOP_K') || 4),
      minScore: Number(config.get('CHATBOT_RAG_MIN_SCORE') ?? 0.45),
      timeoutMs: Number(config.get('CHATBOT_RAG_TIMEOUT_MS') || 20_000),
      onWarning: (message) => this.logger.warn(message),
      embed: async (texts, taskType, signal) => {
        if (!config.get<string>('GEMINI_API_KEY'))
          throw new Error('Embedding API not configured');
        const response = await client.models.embedContent({
          model: RAG_MODEL,
          contents: texts,
          config: {
            taskType,
            outputDimensionality: RAG_DIMENSIONS,
            abortSignal: signal,
            httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } },
          },
        });
        return (response.embeddings ?? []).map(
          (embedding) => embedding.values ?? [],
        );
      },
    });
  }

  async context(query: string, signal?: AbortSignal): Promise<string> {
    if (this.mode === 'none') return '';
    try {
      if (this.mode === 'prompt') {
        const corpus = await loadCorpus(this.docsDir);
        signal?.throwIfAborted();
        // Same reviewed corpus for both baselines; no duplicated static facts.
        const sections = corpus.chunks.map(
          (c) => `[${c.id}] ${c.title} — ${c.heading}\n${c.text}`,
        );
        const text = sections.join('\n\n');
        if (text.length > 40_000)
          throw new Error('Prompt corpus exceeds context limit');
        return JSON.stringify({
          method: 'full_documents',
          missingDocuments: corpus.missing,
          text,
        });
      }
      return JSON.stringify(await this.index.search(query, signal));
    } catch {
      signal?.throwIfAborted();
      return JSON.stringify({
        method: 'unavailable',
        matches: [],
        warning:
          'Không tra cứu được tài liệu. Không suy đoán quy tắc nghiệp vụ chưa có nguồn.',
      });
    }
  }

  async search(query: string, signal?: AbortSignal) {
    if (this.mode !== 'rag')
      return {
        method: 'unavailable',
        matches: [],
        warning: 'Tra cứu tài liệu bị tắt trong chế độ so sánh hiện tại.',
      };
    return this.index.search(query, signal);
  }
}
