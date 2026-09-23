import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateContentParameters, GoogleGenAI } from '@google/genai';
import {
  DEFAULT_LLM_MAX_OUTPUT_TOKENS,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_RETRY_ATTEMPTS,
  LLM_CLIENT,
  LLM_RETRY_STATUS_CODES,
} from './llm.constant';

// Thin wrapper around the Gemini client that applies this app's
// model/maxOutputTokens config so callers (ChatbotService and, later,
// whatever runs the tool-calling loop) never hardcode either — both stay
// configurable per environment via LLM_MODEL/LLM_MAX_OUTPUT_TOKENS.
// Deliberately generic (no chatbot-specific system prompt or tool wiring
// here) — see modules/chatbot for that, matching WebPushService's split
// between "generic client wrapper in libs/" and "domain use in modules/".
@Injectable()
export class LlmService {
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly retryAttempts: number;

  constructor(
    @Inject(LLM_CLIENT) private readonly client: GoogleGenAI,
    config: ConfigService,
  ) {
    this.model = config.get<string>('LLM_MODEL') ?? DEFAULT_LLM_MODEL;
    this.maxOutputTokens = Number(
      config.get<string>('LLM_MAX_OUTPUT_TOKENS') ??
        DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    );
    this.retryAttempts = Number(
      config.get<string>('LLM_RETRY_ATTEMPTS') ?? DEFAULT_LLM_RETRY_ATTEMPTS,
    );
  }

  generateContent(params: Omit<GenerateContentParameters, 'model'>) {
    return this.client.models.generateContent({
      ...params,
      model: this.model,
      config: {
        maxOutputTokens: this.maxOutputTokens,
        // SDK-native retry (exponential backoff + jitter) — only on
        // transient/rate-limit codes, see LLM_RETRY_STATUS_CODES. This is
        // a same-model retry, not the separate fallback-model idea
        // discussed earlier (switching to a cheaper/different model after
        // repeated 429s) — that would sit as a second layer above this one
        // if it's ever built, not a replacement for it.
        httpOptions: {
          retryOptions: {
            attempts: this.retryAttempts,
            httpStatusCodes: LLM_RETRY_STATUS_CODES,
          },
        },
        ...params.config,
      },
    });
  }
}
