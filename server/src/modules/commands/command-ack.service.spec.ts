import { In } from 'typeorm';
import { CommandStatus } from '../../libs/constants/command.constant';
import { CommandAckService } from './command-ack.service';

describe('CommandAckService', () => {
  const repo = { findOne: jest.fn(), update: jest.fn() };
  const mqttClient = {
    on: jest.fn(),
    subscribeAsync: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CommandAckService(mqttClient as never, repo as never);
  const open = In([CommandStatus.PENDING, CommandStatus.SENT]);

  const ack = (topic: string, body: unknown) =>
    service.handleMessage(topic, Buffer.from(JSON.stringify(body)));

  beforeEach(() => {
    jest.clearAllMocks();
    repo.update.mockResolvedValue({ affected: 1 });
    repo.findOne.mockResolvedValue({
      id: 'cmd1',
      status: CommandStatus.SENT,
      channel: { device: { uniqueId: 'esp32-a1' } },
    });
  });

  it('subscribes to the ack topic filter at QoS 1 on init', async () => {
    await service.onModuleInit();

    expect(mqttClient.subscribeAsync).toHaveBeenCalledWith('devices/+/ack', {
      qos: 1,
    });
  });

  it('closes an open command as done', async () => {
    await ack('devices/esp32-a1/ack', { id: 'cmd1', status: 'done' });

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'cmd1', status: open },
      expect.objectContaining({
        status: CommandStatus.DONE,
        errorReason: null,
        ackAt: expect.any(Date) as Date,
      }),
    );
  });

  it('records the reason of a failure', async () => {
    await ack('devices/esp32-a1/ack', {
      id: 'cmd1',
      status: 'failed',
      error: 'unsupported_channel',
    });

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'cmd1', status: open },
      expect.objectContaining({
        status: CommandStatus.FAILED,
        errorReason: 'unsupported_channel',
      }),
    );
  });

  it("ignores an ack for another device's command", async () => {
    await ack('devices/esp32-b2/ack', { id: 'cmd1', status: 'done' });

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('ignores telemetry and malformed acks', async () => {
    await ack('devices/esp32-a1/telemetry', { id: 'cmd1', status: 'done' });
    await ack('devices/esp32-a1/ack', { id: 'cmd1', status: 'sent' });
    await service.handleMessage('devices/esp32-a1/ack', Buffer.from('nope'));

    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
