import {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import { LlmService } from './llm.service';
import {
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLM_RETRY_STATUS_CODES,
} from './llm.constant';

describe('LlmService request options', () => {
  const build = (values: Record<string, string> = {}) => {
    const client = {
      models: {
        generateContent: jest
          .fn<Promise<GenerateContentResponse>, [GenerateContentParameters]>()
          .mockResolvedValue(new GenerateContentResponse()),
      },
    };
    const service = new LlmService(
      client as never,
      { get: (key: string) => values[key] } as never,
    );
    return { service, generate: client.models.generateContent };
  };

  it('keeps SDK retries when the caller supplies a timeout and propagates cancellation', async () => {
    const { service, generate } = build();
    const controller = new AbortController();
    await service.generateContent({
      contents: 'hello',
      config: {
        abortSignal: controller.signal,
        httpOptions: { timeout: 5000 },
      },
    });
    const [params] = generate.mock.calls[0];
    expect(params.config?.abortSignal).toBe(controller.signal);
    expect(params.config?.httpOptions).toEqual({
      timeout: 5000,
      retryOptions: { attempts: 3, httpStatusCodes: LLM_RETRY_STATUS_CODES },
    });
  });

  it.each(['0', '-1', 'invalid'])(
    'retains a finite timeout when configuration is %s',
    async (timeout) => {
      const { service, generate } = build({ LLM_REQUEST_TIMEOUT_MS: timeout });
      await service.generateContent({ contents: 'hello' });
      expect(generate.mock.calls[0][0].config?.httpOptions?.timeout).toBe(
        DEFAULT_LLM_REQUEST_TIMEOUT_MS,
      );
    },
  );
});
