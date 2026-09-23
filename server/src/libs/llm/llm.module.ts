import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { LLM_CLIENT } from './llm.constant';
import { LlmService } from './llm.service';

const logger = new Logger('LlmModule');

const llmProvider: Provider = {
  provide: LLM_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const apiKey = config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      // Don't crash at boot over this, same reasoning as WebPushModule —
      // most of the app works fine without the chatbot. Only
      // LlmService.generateContent() fails, once something actually tries
      // to chat.
      logger.warn(
        'GEMINI_API_KEY not set — chatbot LLM calls will fail until configured.',
      );
    }
    // Google AI Studio (Gemini Developer API) key, not a Vertex AI service
    // account — passing apiKey (and leaving vertexai unset) is what
    // selects that backend. Placeholder keeps ConfigService as the single
    // source of truth instead of falling back to the SDK's own implicit
    // process.env.GEMINI_API_KEY lookup.
    return new GoogleGenAI({ apiKey: apiKey ?? 'missing-api-key' });
  },
};

// Not @Global(): only ChatbotModule consumes this, same reasoning as
// WebPushModule.
@Module({
  imports: [ConfigModule],
  providers: [llmProvider, LlmService],
  exports: [LLM_CLIENT, LlmService],
})
export class LlmModule {}
