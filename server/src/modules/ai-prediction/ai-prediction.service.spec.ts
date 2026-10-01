import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AI_PREDICTION_COOLDOWN_MS,
  AI_PREDICTION_FAILURE_THRESHOLD,
  AI_PREDICTION_TTL_SECONDS,
} from '../../libs/constants/ai-prediction.constant';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { AiPredictionService } from './ai-prediction.service';

describe('AiPredictionService', () => {
  let service: AiPredictionService;
  const mockConfigService = {
    get: jest.fn().mockReturnValue('http://localhost:8000'),
  };
  // multi() returns a chainable transaction ending in exec().
  const redis = {
    hgetall: jest.fn(),
    hset: jest.fn(),
    expire: jest.fn(),
    exec: jest.fn(),
    multi: jest.fn(),
  };
  redis.hset.mockReturnValue(redis);
  redis.expire.mockReturnValue(redis);
  redis.multi.mockReturnValue(redis);

  const mockResponse = {
    predicted_temp_15m: 8.64,
    will_exceed_threshold: true,
    violation_type: 'OVERHEAT' as const,
    risk_level: 'CRITICAL' as const,
    recommendation: 'Warning overheat',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiPredictionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get<AiPredictionService>(AiPredictionService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('successfully predicts and returns prediction response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockResponse),
    });

    const result = await service.predict({
      temperature: 8.2,
      temp_min: 2.0,
      temp_max: 8.0,
      hour_of_day: 14,
    });

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/internal/ai/predict',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('returns null when AI service responds with an error status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const result = await service.predict({
      temperature: 4.5,
    });

    expect(result).toBeNull();
  });

  it('returns null and catches exception when fetch throws an error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('Connection refused / timeout'));

    const result = await service.predict({
      temperature: 4.5,
    });

    expect(result).toBeNull();
  });

  it('stops calling the AI service after repeated failures, until the cooldown passes', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));

    for (let i = 0; i < AI_PREDICTION_FAILURE_THRESHOLD; i++) {
      await service.predict({ temperature: 4.5 });
    }
    expect(global.fetch).toHaveBeenCalledTimes(AI_PREDICTION_FAILURE_THRESHOLD);

    await expect(service.predict({ temperature: 4.5 })).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(AI_PREDICTION_FAILURE_THRESHOLD);

    now.mockReturnValue(1_000_000 + AI_PREDICTION_COOLDOWN_MS);
    await service.predict({ temperature: 4.5 });
    expect(global.fetch).toHaveBeenCalledTimes(
      AI_PREDICTION_FAILURE_THRESHOLD + 1,
    );
  });

  it("stores each device's latest prediction in the room's hash, refreshing its TTL", async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    await service.saveLatest('r1', 'd1', mockResponse);

    expect(redis.hset).toHaveBeenCalledWith(
      'ai:prediction:r1',
      'd1',
      JSON.stringify({
        predictedTemp15m: 8.64,
        willExceedThreshold: true,
        violationType: 'OVERHEAT',
        riskLevel: 'CRITICAL',
        recommendation: 'Warning overheat',
        at: 1_000_000,
      }),
    );
    expect(redis.expire).toHaveBeenCalledWith(
      'ai:prediction:r1',
      AI_PREDICTION_TTL_SECONDS,
    );
    expect(redis.exec).toHaveBeenCalled();
  });

  describe('getLatest', () => {
    const now = 10_000_000;
    const stored = (riskLevel: string, at: number, predictedTemp15m = 3) =>
      JSON.stringify({
        predictedTemp15m,
        willExceedThreshold: riskLevel === 'CRITICAL',
        violationType: riskLevel === 'CRITICAL' ? 'OVERHEAT' : 'NONE',
        riskLevel,
        recommendation: riskLevel,
        at,
      });

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(now);
    });

    it("returns the room's most serious fresh forecast, without the timestamp", async () => {
      redis.hgetall.mockResolvedValueOnce({
        d1: stored('NORMAL', now - 1_000, 2.5),
        d2: stored('CRITICAL', now - 60_000, 4.6),
        d3: stored('WARNING', now - 1_000, 3.7),
      });

      await expect(service.getLatest('r1')).resolves.toEqual({
        predictedTemp15m: 4.6,
        willExceedThreshold: true,
        violationType: 'OVERHEAT',
        riskLevel: 'CRITICAL',
        recommendation: 'CRITICAL',
      });
      expect(redis.hgetall).toHaveBeenCalledWith('ai:prediction:r1');
    });

    it('ignores a device whose forecast is older than the TTL', async () => {
      redis.hgetall.mockResolvedValueOnce({
        d1: stored('CRITICAL', now - AI_PREDICTION_TTL_SECONDS * 1000 - 1),
        d2: stored('NORMAL', now - 1_000, 2.5),
      });

      await expect(service.getLatest('r1')).resolves.toMatchObject({
        riskLevel: 'NORMAL',
        predictedTemp15m: 2.5,
      });
    });

    it('prefers the newest forecast on equal risk', async () => {
      redis.hgetall.mockResolvedValueOnce({
        d1: stored('NORMAL', now - 60_000, 2),
        d2: stored('NORMAL', now - 1_000, 2.5),
      });

      await expect(service.getLatest('r1')).resolves.toMatchObject({
        predictedTemp15m: 2.5,
      });
    });

    it('returns null when nothing is stored or Redis fails', async () => {
      redis.hgetall.mockResolvedValueOnce({});
      await expect(service.getLatest('r1')).resolves.toBeNull();

      redis.hgetall.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.getLatest('r1')).resolves.toBeNull();
    });
  });
});
