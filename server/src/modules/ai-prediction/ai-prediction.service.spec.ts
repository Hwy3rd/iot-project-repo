import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AI_PREDICTION_COOLDOWN_MS,
  AI_PREDICTION_FAILURE_THRESHOLD,
  AI_PREDICTION_TTL_SECONDS,
} from '../../libs/constants/ai-prediction.constant';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { AiPredictionService } from './ai-prediction.service';
import {
  AI_FORECAST_SCHEMA,
  AiPredictRequestDto,
} from './dto/ai-prediction.dto';

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
    forecast_schema: AI_FORECAST_SCHEMA,
    as_of: new Date(1_000_000).toISOString(),
    forecasts: [
      {
        horizon_minutes: 5 as const,
        predicted_temp: 8.64,
        will_exceed_threshold: true,
        violation_type: 'OVERHEAT' as const,
      },
      {
        horizon_minutes: 10 as const,
        predicted_temp: 7.5,
        will_exceed_threshold: false,
        violation_type: 'NONE' as const,
      },
    ],
    first_violation_minutes: 5 as const,
    will_exceed_threshold: true,
    violation_type: 'OVERHEAT' as const,
    risk_level: 'CRITICAL' as const,
    recommendation: 'Warning overheat',
  };

  const request = (temperature: number): AiPredictRequestDto => ({
    feature_schema: 'temperature-history-v1',
    temperature,
    temperature_history: Array.from({ length: 13 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 9, 4, 9, i * 5)).toISOString(),
      temperature,
    })),
  });

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
      ...request(8.2),
      temp_min: 2.0,
      temp_max: 8.0,
    });

    expect(result).toEqual(mockResponse);
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body),
    ).toEqual({
      ...request(8.2),
      temp_min: 2,
      temp_max: 8,
    });
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
      ...request(4.5),
    });

    expect(result).toBeNull();
  });

  it('returns null and catches exception when fetch throws an error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('Connection refused / timeout'));

    const result = await service.predict({
      ...request(4.5),
    });

    expect(result).toBeNull();
  });

  it('stops calling the AI service after repeated failures, until the cooldown passes', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));

    for (let i = 0; i < AI_PREDICTION_FAILURE_THRESHOLD; i++) {
      await service.predict(request(4.5));
    }
    expect(global.fetch).toHaveBeenCalledTimes(AI_PREDICTION_FAILURE_THRESHOLD);

    await expect(service.predict(request(4.5))).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(AI_PREDICTION_FAILURE_THRESHOLD);

    now.mockReturnValue(1_000_000 + AI_PREDICTION_COOLDOWN_MS);
    await service.predict(request(4.5));
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
        response: mockResponse,
        at: 1_000_000,
      }),
    );
    expect(redis.expire).toHaveBeenCalledWith(
      'ai:prediction:r1',
      AI_PREDICTION_TTL_SECONDS,
    );
    expect(redis.exec).toHaveBeenCalled();
  });

  it('rejects legacy, malformed or inconsistent forecast responses', async () => {
    const invalid = [
      { predicted_temp_15m: 8.6 },
      { ...mockResponse, forecasts: [mockResponse.forecasts[0]] },
      {
        ...mockResponse,
        forecasts: [mockResponse.forecasts[1], mockResponse.forecasts[0]],
      },
      { ...mockResponse, will_exceed_threshold: false },
      { ...mockResponse, as_of: 'invalid' },
      {
        ...mockResponse,
        forecasts: [
          { ...mockResponse.forecasts[0], predicted_temp: NaN },
          mockResponse.forecasts[1],
        ],
      },
    ];
    for (const payload of invalid) {
      service = new AiPredictionService(
        mockConfigService as unknown as ConfigService,
        redis as never,
      );
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => payload });
      await expect(service.predict(request(3))).resolves.toBeNull();
    }
  });

  describe('getLatest', () => {
    const now = 10_000_000;
    const stored = (riskLevel: string, at: number, predictedTemp = 3) => {
      const breach = predictedTemp > 4;
      return JSON.stringify({
        at,
        response: {
          forecast_schema: AI_FORECAST_SCHEMA,
          as_of: new Date(at).toISOString(),
          forecasts: [5, 10].map((horizon_minutes) => ({
            horizon_minutes,
            predicted_temp: predictedTemp,
            will_exceed_threshold: breach,
            violation_type: breach ? 'OVERHEAT' : 'NONE',
          })),
          first_violation_minutes: breach ? 5 : null,
          will_exceed_threshold: breach,
          violation_type: breach ? 'OVERHEAT' : 'NONE',
          risk_level: riskLevel,
          recommendation: riskLevel,
        },
      });
    };

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(now);
    });

    it("returns the room's most serious fresh forecast, with when it was made", async () => {
      redis.hgetall.mockResolvedValueOnce({
        d1: stored('NORMAL', now - 1_000, 2.5),
        d2: stored('CRITICAL', now - 60_000, 4.6),
        d3: stored('WARNING', now - 1_000, 3.7),
      });

      // Chart targets are relative to the latest input timestamp.
      await expect(service.getLatest('r1')).resolves.toEqual({
        predictedAt: new Date(now - 60_000),
        forecasts: [5, 10].map((horizonMinutes) => ({
          horizonMinutes,
          predictedTemp: 4.6,
          willExceedThreshold: true,
          violationType: 'OVERHEAT',
        })),
        firstViolationMinutes: 5,
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
        forecasts: expect.arrayContaining([
          expect.objectContaining({ predictedTemp: 2.5 }),
        ]),
      });
    });

    it('prefers the newest forecast on equal risk', async () => {
      redis.hgetall.mockResolvedValueOnce({
        d1: stored('NORMAL', now - 60_000, 2),
        d2: stored('NORMAL', now - 1_000, 2.5),
      });

      await expect(service.getLatest('r1')).resolves.toMatchObject({
        forecasts: expect.arrayContaining([
          expect.objectContaining({ predictedTemp: 2.5 }),
        ]),
      });
    });

    it('ignores old cache rows and corrupt JSON without hiding a valid device', async () => {
      redis.hgetall.mockResolvedValueOnce({
        old: JSON.stringify({ at: now, predictedTemp15m: 99 }),
        corrupt: '{',
        valid: stored('NORMAL', now - 1000, 2.5),
      });
      await expect(service.getLatest('r1')).resolves.toMatchObject({
        willExceedThreshold: false,
      });
    });

    it('expires predictions based on input time even when just cached', async () => {
      const value = JSON.parse(
        stored('NORMAL', now - AI_PREDICTION_TTL_SECONDS * 1000, 2.5),
      );
      value.at = now;
      redis.hgetall.mockResolvedValueOnce({ d1: JSON.stringify(value) });
      await expect(service.getLatest('r1')).resolves.toBeNull();
    });

    it('prioritizes an actual forecast breach over a newer near-threshold advisory', async () => {
      redis.hgetall.mockResolvedValueOnce({
        breach: stored('WARNING', now - 60_000, 4.6),
        near: stored('WARNING', now - 1000, 3.7),
      });
      await expect(service.getLatest('r1')).resolves.toMatchObject({
        willExceedThreshold: true,
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
