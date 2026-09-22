import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

describe('TelemetryController', () => {
  let controller: TelemetryController;
  const telemetryService = {
    findHourly: jest.fn(),
    findRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [{ provide: TelemetryService, useValue: telemetryService }],
    }).compile();

    controller = module.get<TelemetryController>(TelemetryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findHourly to the service', async () => {
    const query = { from: '2026-09-21T00:00:00.000Z' };
    telemetryService.findHourly.mockResolvedValue([{ deviceId: 'd1' }]);

    await expect(controller.findHourly('d1', query)).resolves.toEqual([
      { deviceId: 'd1' },
    ]);

    expect(telemetryService.findHourly).toHaveBeenCalledWith('d1', query);
  });

  it('delegates findRaw to the service', async () => {
    const query = { limit: 10 };
    telemetryService.findRaw.mockResolvedValue([]);

    await controller.findRaw('d1', query);

    expect(telemetryService.findRaw).toHaveBeenCalledWith('d1', query);
  });
});
