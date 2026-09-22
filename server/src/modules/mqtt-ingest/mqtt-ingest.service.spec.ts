import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { Device } from '../devices/entities/device.entity';
import { TelemetryService } from '../telemetry/telemetry.service';
import { MqttIngestService } from './mqtt-ingest.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

describe('MqttIngestService', () => {
  let service: MqttIngestService;
  let devicesRepository: MockRepository<Device>;
  let telemetryService: { ingest: jest.Mock };
  let mqttClient: { on: jest.Mock; subscribeAsync: jest.Mock };

  beforeEach(async () => {
    devicesRepository = { findOne: jest.fn() };
    telemetryService = { ingest: jest.fn() };
    mqttClient = {
      on: jest.fn(),
      subscribeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MqttIngestService,
        { provide: MQTT_CLIENT, useValue: mqttClient },
        { provide: getRepositoryToken(Device), useValue: devicesRepository },
        { provide: TelemetryService, useValue: telemetryService },
      ],
    }).compile();

    service = module.get<MqttIngestService>(MqttIngestService);
    await service.onModuleInit();
  });

  const publish = (topic: string, body: unknown) =>
    service.handleMessage(topic, Buffer.from(JSON.stringify(body)));

  it('subscribes to the device telemetry topic filter at QoS 1 on init', () => {
    expect(mqttClient.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mqttClient.subscribeAsync).toHaveBeenCalledWith(
      'devices/+/telemetry',
      { qos: 1 },
    );
  });

  it('ingests a valid sample for a known device', async () => {
    devicesRepository.findOne!.mockResolvedValue({
      id: 'device-uuid',
      uniqueId: 'esp32-1',
    });

    await publish('devices/esp32-1/telemetry', {
      ts: '2026-01-01T00:00:00.000Z',
      temperature: -18.5,
      doorOpen: false,
      sensorFault: false,
    });

    expect(devicesRepository.findOne).toHaveBeenCalledWith({
      where: { uniqueId: 'esp32-1' },
    });
    expect(telemetryService.ingest).toHaveBeenCalledWith(
      'device-uuid',
      expect.objectContaining({
        temperature: -18.5,
        doorOpen: false,
        sensorFault: false,
      }),
    );
    const [, sample] = telemetryService.ingest.mock.calls[0] as [
      string,
      { ts: Date },
    ];
    expect(sample.ts).toBeInstanceOf(Date);
  });

  it('accepts a null temperature (device-reported sensor fault)', async () => {
    devicesRepository.findOne!.mockResolvedValue({
      id: 'device-uuid',
      uniqueId: 'esp32-1',
    });

    await publish('devices/esp32-1/telemetry', {
      ts: '2026-01-01T00:00:00.000Z',
      temperature: null,
      doorOpen: false,
      sensorFault: true,
    });

    expect(telemetryService.ingest).toHaveBeenCalledWith(
      'device-uuid',
      expect.objectContaining({ temperature: null, sensorFault: true }),
    );
  });

  it('ignores messages on topics that are not device telemetry', async () => {
    await publish('some/other/topic', {});

    expect(devicesRepository.findOne).not.toHaveBeenCalled();
    expect(telemetryService.ingest).not.toHaveBeenCalled();
  });

  it('ignores a non-JSON payload without throwing', async () => {
    await expect(
      service.handleMessage(
        'devices/esp32-1/telemetry',
        Buffer.from('not json'),
      ),
    ).resolves.toBeUndefined();

    expect(devicesRepository.findOne).not.toHaveBeenCalled();
  });

  it('ignores a payload that fails validation', async () => {
    await publish('devices/esp32-1/telemetry', {
      ts: 'not-a-date',
      doorOpen: 'nope',
      sensorFault: false,
    });

    expect(devicesRepository.findOne).not.toHaveBeenCalled();
    expect(telemetryService.ingest).not.toHaveBeenCalled();
  });

  it('ignores telemetry from a device unique_id not in the database', async () => {
    devicesRepository.findOne!.mockResolvedValue(null);

    await publish('devices/unknown-device/telemetry', {
      ts: '2026-01-01T00:00:00.000Z',
      temperature: 4,
      doorOpen: false,
      sensorFault: false,
    });

    expect(telemetryService.ingest).not.toHaveBeenCalled();
  });

  it('swallows a rejection from TelemetryService.ingest (e.g. unclaimed device)', async () => {
    devicesRepository.findOne!.mockResolvedValue({
      id: 'device-uuid',
      uniqueId: 'esp32-1',
    });
    telemetryService.ingest.mockRejectedValue(
      new Error('not assigned to a cold room'),
    );

    await expect(
      publish('devices/esp32-1/telemetry', {
        ts: '2026-01-01T00:00:00.000Z',
        temperature: 4,
        doorOpen: false,
        sensorFault: false,
      }),
    ).resolves.toBeUndefined();
  });
});
