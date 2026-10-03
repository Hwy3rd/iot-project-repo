import { EntityManager } from 'typeorm';
import {
  CHANNEL_TYPE_ROLE,
  DEVICE_DEFAULT_CHANNELS,
} from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from './entities/device-channel.entity';

// Adds the board's default channels (DEVICE_DEFAULT_CHANNELS) whose type the
// device doesn't declare yet; channels already there — default or added by
// hand, relabelled or not — are left alone, so it is safe to run again.
// Takes an EntityManager so the claim can run it in its own transaction.
export async function addMissingDefaultChannels(
  manager: EntityManager,
  deviceId: string,
): Promise<DeviceChannel[]> {
  const existing = await manager.find(DeviceChannel, {
    where: { deviceId },
    select: { id: true, channelType: true },
  });
  const declared = new Set(existing.map((c) => c.channelType));
  const missing = DEVICE_DEFAULT_CHANNELS.filter(
    (c) => !declared.has(c.channelType),
  );
  if (missing.length === 0) return [];
  return manager.save(
    DeviceChannel,
    missing.map((c) =>
      manager.create(DeviceChannel, {
        deviceId,
        channelType: c.channelType,
        channelRole: CHANNEL_TYPE_ROLE[c.channelType],
        label: c.label,
      }),
    ),
  );
}
