import { In } from 'typeorm';
import {
  COMMAND_MAX_ATTEMPTS,
  CommandAction,
  CommandStatus,
} from '../../libs/constants/command.constant';
import { CommandDispatcherService } from './command-dispatcher.service';
import { Command } from './entities/command.entity';

describe('CommandDispatcherService', () => {
  const commandsRepo = { update: jest.fn() };
  const channelsRepo = { findOne: jest.fn() };
  const mqttClient = { connected: true, publishAsync: jest.fn() };
  const service = new CommandDispatcherService(
    commandsRepo as never,
    channelsRepo as never,
    mqttClient as never,
  );
  const now = new Date('2026-10-03T08:00:00Z');
  const command = {
    id: 'cmd1',
    channelId: 'c1',
    action: CommandAction.ON,
    attempts: 0,
    expiresAt: new Date('2026-10-03T08:01:00Z'),
  } as Command;

  beforeEach(() => {
    jest.clearAllMocks();
    mqttClient.connected = true;
    mqttClient.publishAsync.mockResolvedValue(undefined);
    channelsRepo.findOne.mockResolvedValue({
      id: 'c1',
      channelType: 'fan_motor',
      label: null,
      device: { uniqueId: 'esp32-a1' },
    });
  });

  it("publishes to the device's command topic at QoS 1, then marks it sent", async () => {
    await expect(service.dispatch(command, now)).resolves.toBe(true);

    expect(mqttClient.publishAsync).toHaveBeenCalledWith(
      'devices/esp32-a1/commands',
      JSON.stringify({
        id: 'cmd1',
        channel: 'fan_motor',
        label: null,
        action: 'on',
        expiresAt: '2026-10-03T08:01:00.000Z',
      }),
      { qos: 1 },
    );
    expect(commandsRepo.update).toHaveBeenCalledWith(
      { id: 'cmd1', status: In([CommandStatus.PENDING, CommandStatus.SENT]) },
      expect.objectContaining({ status: CommandStatus.SENT, sentAt: now }),
    );
  });

  it('does nothing while the broker is unreachable', async () => {
    mqttClient.connected = false;

    await expect(service.dispatch(command, now)).resolves.toBe(false);
    expect(mqttClient.publishAsync).not.toHaveBeenCalled();
    expect(commandsRepo.update).not.toHaveBeenCalled();
  });

  it('stops once the attempt budget is spent', async () => {
    await expect(
      service.dispatch(
        { ...command, attempts: COMMAND_MAX_ATTEMPTS } as Command,
        now,
      ),
    ).resolves.toBe(false);
    expect(mqttClient.publishAsync).not.toHaveBeenCalled();
  });

  it('leaves the command open when the publish fails', async () => {
    mqttClient.publishAsync.mockRejectedValue(new Error('boom'));

    await expect(service.dispatch(command, now)).resolves.toBe(false);
    expect(commandsRepo.update).not.toHaveBeenCalled();
  });

  it('does not publish when the device is gone', async () => {
    channelsRepo.findOne.mockResolvedValue({ id: 'c1', device: null });

    await expect(service.dispatch(command, now)).resolves.toBe(false);
    expect(mqttClient.publishAsync).not.toHaveBeenCalled();
  });
});
