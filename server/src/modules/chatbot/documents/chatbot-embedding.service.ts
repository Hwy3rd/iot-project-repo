import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { LLM_CLIENT } from '../../../libs/llm/llm.constant';
import { RAG_DIMENSIONS, RAG_MODEL, type Embedder } from '../tools/chatbot-rag';

@Injectable()
export class ChatbotEmbeddingService {
  constructor(
    @Inject(LLM_CLIENT) private readonly client: GoogleGenAI,
    private readonly config: ConfigService,
  ) {}
  get available(): boolean {
    return !!this.config.get<string>('GEMINI_API_KEY');
  }
  readonly embed: Embedder = async (texts, taskType, signal) => {
    if (!this.available) throw new Error('Embedding service is not configured');
    const response = await this.client.models.embedContent({
      model: RAG_MODEL,
      contents: texts,
      config: {
        taskType,
        outputDimensionality: RAG_DIMENSIONS,
        abortSignal: signal,
        httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } },
      },
    });
    return (response.embeddings ?? []).map((e) => e.values ?? []);
  };
}
