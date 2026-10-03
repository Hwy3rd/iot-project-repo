import {
  ChannelRole,
  ChannelType,
  DEVICE_DEFAULT_CHANNELS,
} from '../../libs/constants/device-channel.constant';
import { addMissingDefaultChannels } from './default-channels';
import { DeviceChannel } from './entities/device-channel.entity';

describe('addMissingDefaultChannels', () => {
  const manager = {
    find: jest.fn(),
    create: jest.fn((_entity: unknown, value: unknown) => value),
    save: jest.fn((_entity: unknown, value: unknown) => Promise.resolve(value)),
  };

  beforeEach(() => jest.clearAllMocks());

  it('declares every default channel on a device that has none', async () => {
    manager.find.mockResolvedValue([]);

    const added = await addMissingDefaultChannels(manager as never, 'd1');

    expect(added.map((c) => c.channelType)).toEqual(
      DEVICE_DEFAULT_CHANNELS.map((c) => c.channelType),
    );
    expect(added.find((c) => c.channelType === ChannelType.FAN_MOTOR)).toEqual(
      expect.objectContaining({
        deviceId: 'd1',
        channelRole: ChannelRole.ACTUATOR,
        label: 'Quạt làm lạnh',
      }),
    );
  });

  it('only adds the types the device lacks, keeping what is there', async () => {
    manager.find.mockResolvedValue([
      { id: 'a', channelType: ChannelType.LIMIT_SWITCH },
      { id: 'b', channelType: ChannelType.TEMP_HUMIDITY_SENSOR },
    ]);

    const added = await addMissingDefaultChannels(manager as never, 'd1');

    expect(added.map((c) => c.channelType)).toEqual([
      ChannelType.CURRENT_SENSOR,
      ChannelType.FAN_MOTOR,
      ChannelType.BUZZER,
    ]);
  });

  it('does nothing once every default is declared', async () => {
    manager.find.mockResolvedValue(
      DEVICE_DEFAULT_CHANNELS.map((c, i) => ({
        id: String(i),
        channelType: c.channelType,
      })),
    );

    await expect(
      addMissingDefaultChannels(manager as never, 'd1'),
    ).resolves.toEqual([]);
    expect(manager.save).not.toHaveBeenCalledWith(
      DeviceChannel,
      expect.anything(),
    );
  });
});
