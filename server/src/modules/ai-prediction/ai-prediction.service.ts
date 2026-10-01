import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  AI_PREDICTION_COOLDOWN_MS,
  AI_PREDICTION_FAILURE_THRESHOLD,
  AI_PREDICTION_TIMEOUT_MS,
  AI_PREDICTION_TTL_SECONDS,
} from '../../libs/constants/ai-prediction.constant';
import { aiPredictionKey, REDIS_CLIENT } from '../../libs/redis/redis.constant';
import {
  AiPredictRequestDto,
  AiPredictResponseDto,
  ColdRoomPrediction,
} from './dto/ai-prediction.dto';

interface StoredPrediction extends ColdRoomPrediction {
  // When it was stored (ms epoch) — fields of one hash share the key's TTL,
  // so freshness per device is checked against this instead.
  at: number;
}

const RISK_ORDER = ['NORMAL', 'WARNING', 'CRITICAL'];
const riskRank = (riskLevel: string) => RISK_ORDER.indexOf(riskLevel);

@Injectable()
export class AiPredictionService {
  private readonly logger = new Logger(AiPredictionService.name);
  private readonly aiServiceUrl: string;

  // Circuit breaker state. Per process, which is fine: only the API process
  // calls the AI service.
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Calls the FastAPI AI microservice to predict temperature 15 minutes ahead.
   * Fault-tolerant with timeout: never throws. While the circuit is open
   * (the service failed repeatedly) it returns null without calling out.
   */
  async predict(
    payload: AiPredictRequestDto,
  ): Promise<AiPredictResponseDto | null> {
    if (Date.now() < this.openUntil) {
      return null;
    }
    const url = `${this.aiServiceUrl}/internal/ai/predict`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(AI_PREDICTION_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.recordFailure(
          `AI service returned status ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const result = (await response.json()) as AiPredictResponseDto;
      this.consecutiveFailures = 0;
      return result;
    } catch (error) {
      this.recordFailure(
        `Failed to call AI prediction service at ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  // One hash per room, one field per device: a room with several devices
  // keeps each device's latest forecast instead of the last writer's.
  // Best effort, like predict(): the forecast is a hint, so a Redis hiccup
  // only means the chart shows none for a moment.
  async saveLatest(
    coldRoomId: string,
    deviceId: string,
    prediction: AiPredictResponseDto,
  ): Promise<void> {
    const value: StoredPrediction = {
      predictedTemp15m: prediction.predicted_temp_15m,
      willExceedThreshold: prediction.will_exceed_threshold,
      violationType: prediction.violation_type,
      riskLevel: prediction.risk_level,
      recommendation: prediction.recommendation,
      at: Date.now(),
    };
    const key = aiPredictionKey(coldRoomId);
    try {
      // The key's TTL drops the hash once every device in the room went
      // quiet; a single quiet device is filtered by `at` in getLatest().
      await this.redis
        .multi()
        .hset(key, deviceId, JSON.stringify(value))
        .expire(key, AI_PREDICTION_TTL_SECONDS)
        .exec();
    } catch (error) {
      this.logger.warn(
        `Could not store AI prediction for room ${coldRoomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // The room's most serious recent forecast (newest on a tie), so one
  // device's safe forecast never hides another device's warning.
  async getLatest(coldRoomId: string): Promise<ColdRoomPrediction | null> {
    try {
      const fields = await this.redis.hgetall(aiPredictionKey(coldRoomId));
      const freshSince = Date.now() - AI_PREDICTION_TTL_SECONDS * 1000;
      let worst: StoredPrediction | null = null;
      for (const raw of Object.values(fields)) {
        const candidate = JSON.parse(raw) as StoredPrediction;
        if (candidate.at < freshSince) continue;
        const rank = riskRank(candidate.riskLevel);
        const worstRank = worst ? riskRank(worst.riskLevel) : -1;
        if (
          !worst ||
          rank > worstRank ||
          (rank === worstRank && candidate.at > worst.at)
        ) {
          worst = candidate;
        }
      }
      if (!worst) return null;
      return {
        predictedTemp15m: worst.predictedTemp15m,
        willExceedThreshold: worst.willExceedThreshold,
        violationType: worst.violationType,
        riskLevel: worst.riskLevel,
        recommendation: worst.recommendation,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read AI prediction for room ${coldRoomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private recordFailure(message: string) {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures < AI_PREDICTION_FAILURE_THRESHOLD) {
      this.logger.warn(message);
      return;
    }
    this.openUntil = Date.now() + AI_PREDICTION_COOLDOWN_MS;
    this.consecutiveFailures = 0;
    this.logger.warn(
      `${message} — pausing AI predictions for ${AI_PREDICTION_COOLDOWN_MS / 1000}s`,
    );
  }
}
