import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiPredictRequestDto,
  AiPredictResponseDto,
} from './dto/ai-prediction.dto';

@Injectable()
export class AiPredictionService {
  private readonly logger = new Logger(AiPredictionService.name);
  private readonly aiServiceUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.aiServiceUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Calls the FastAPI AI microservice to predict temperature 15 minutes ahead.
   * Fault-tolerant with timeout: never throws or blocks callers.
   */
  async predict(
    payload: AiPredictRequestDto,
  ): Promise<AiPredictResponseDto | null> {
    const url = `${this.aiServiceUrl}/internal/ai/predict`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1500),
      });

      if (!response.ok) {
        this.logger.warn(
          `AI service returned status ${response.status} ${response.statusText}`,
        );
        return null;
      }

      return (await response.json()) as AiPredictResponseDto;
    } catch (error) {
      this.logger.warn(
        `Failed to call AI prediction service at ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
