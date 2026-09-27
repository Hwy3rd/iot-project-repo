import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AiPredictionService } from './ai-prediction.service';

describe('AiPredictionService', () => {
  let service: AiPredictionService;
  const mockConfigService = {
    get: jest.fn().mockReturnValue('http://localhost:8000'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiPredictionService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AiPredictionService>(AiPredictionService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('successfully predicts and returns prediction response', async () => {
    const mockResponse = {
      predicted_temp_15m: 8.64,
      will_exceed_threshold: true,
      violation_type: 'OVERHEAT',
      risk_level: 'CRITICAL',
      recommendation: 'Warning overheat',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockResponse),
    } as unknown as Response);

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
    } as unknown as Response);

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
});
