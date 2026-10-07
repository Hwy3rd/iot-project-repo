import { EventEmitter } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeviceStatus } from '../../libs/constants/device.constant';
import { MQTT_CLIENT } from '../../libs/mqtt/mqtt.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { Device } from '../devices/entities/device.entity';
import { DeviceConfigService } from './device-config.service';

const UPDATED_AT = new Date('2026-10-07T08:00:00.000Z');

const room = (overrides: Partial<ColdRoom> = {}) =>
  ({
    id: 'r1',
    tempMin: 28,
    tempMax: 30,
    hysteresis: 0.5,
    doorOpenMaxSeconds: 30,
    updatedAt: UPDATED_AT,
    ...overrides,
  }) as ColdRoom;

const device = (overrides: Partial<Device> = {}) =>
  ({
    id: 'd1',
    uniqueId: 'esp32-01',
    coldRoomId: 'r1',
    status: DeviceStatus.ACTIVE,
    deletedAt: null,
    ...overrides,
  }) as Device;

describe('DeviceConfigService', () => {
  let service: DeviceConfigService;
  let devicesRepository: { find: jest.Mock; findOne: jest.Mock };
  let coldRoomsRepository: { findBy: jest.Mock };
  let mqttClient: EventEmitter & {
    connected: boolean;
    publishAsync: jest.Mock;
  };

  beforeEach(async () => {
    devicesRepository = { find: jest.fn(), findOne: jest.fn() };
    coldRoomsRepository = { findBy: jest.fn().mockResolvedValue([room()]) };
    mqttClient = Object.assign(new EventEmitter(), {
      connected: true,
      publishAsync: jest.fn().mockResolvedValue(undefined),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceConfigService,
        { provide: getRepositoryToken(Device), useValue: devicesRepository },
        {
          provide: getRepositoryToken(ColdRoom),
          useValue: coldRoomsRepository,
        },
        { provide: MQTT_CLIENT, useValue: mqttClient },
      ],
    }).compile();

    service = module.get(DeviceConfigService);
  });

  it("publishes the room's thresholds as a retained message", async () => {
    devicesRepository.find.mockResolvedValue([device()]);

    await service.publishForRoom('r1');

    expect(devicesRepository.find).toHaveBeenCalledWith({
      where: { coldRoomId: 'r1' },
    });
    expect(mqttClient.publishAsync).toHaveBeenCalledWith(
      'devices/esp32-01/config',
      JSON.stringify({
        version: UPDATED_AT.toISOString(),
        tempMin: 28,
        tempMax: 30,
        hysteresis: 0.5,
        doorOpenMaxSeconds: 30,
      }),
      { qos: 1, retain: true },
    );
  });

  it.each([
    ['its room was deleted', device(), []],
    ['it has no room', device({ coldRoomId: null }), [room()]],
    [
      'it was decommissioned',
      device({ status: DeviceStatus.DECOMMISSIONED }),
      [room()],
    ],
    ['it was deleted', device({ deletedAt: new Date() }), [room()]],
  ])('clears the retained config when %s', async (_case, d, rooms) => {
    devicesRepository.findOne.mockResolvedValue(d);
    coldRoomsRepository.findBy.mockResolvedValue(rooms);

    await service.publishForDevice('d1');

    expect(devicesRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'd1' },
      withDeleted: true,
    });
    expect(mqttClient.publishAsync).toHaveBeenCalledWith(
      'devices/esp32-01/config',
      '',
      { qos: 1, retain: true },
    );
  });

  it('skips publishing while disconnected (the reconnect sync covers it)', async () => {
    mqttClient.connected = false;
    devicesRepository.find.mockResolvedValue([device()]);

    await service.publishForRoom('r1');

    expect(mqttClient.publishAsync).not.toHaveBeenCalled();
  });

  it('never throws when the broker rejects a publish', async () => {
    devicesRepository.find.mockResolvedValue([device()]);
    mqttClient.publishAsync.mockRejectedValue(new Error('not authorized'));

    await expect(service.publishForRoom('r1')).resolves.toBeUndefined();
  });

  it('re-syncs every device, deleted ones included, on (re)connect', async () => {
    devicesRepository.find.mockResolvedValue([
      device(),
      device({ id: 'd2', uniqueId: 'esp32-02', deletedAt: new Date() }),
    ]);
    service.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));

    expect(devicesRepository.find).toHaveBeenCalledWith({ withDeleted: true });
    expect(mqttClient.publishAsync).toHaveBeenCalledTimes(2);
    expect(mqttClient.publishAsync).toHaveBeenCalledWith(
      'devices/esp32-02/config',
      '',
      { qos: 1, retain: true },
    );

    mqttClient.publishAsync.mockClear();
    mqttClient.emit('connect');
    await new Promise((resolve) => setImmediate(resolve));
    expect(mqttClient.publishAsync).toHaveBeenCalledTimes(2);
  });
});
