import { In, Repository } from 'typeorm';
import { ChannelType } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from './entities/device-channel.entity';

// deviceId -> the channel types it declares (deduped), for every requested
// device; a device declaring none maps to []. One query for all of them.
export async function declaredChannelTypes(
  channelsRepository: Repository<DeviceChannel>,
  deviceIds: string[],
): Promise<Map<string, ChannelType[]>> {
  const result = new Map<string, ChannelType[]>(
    deviceIds.map((id) => [id, []]),
  );
  if (deviceIds.length === 0) return result;
  const rows = await channelsRepository.find({
    where: { deviceId: In(deviceIds) },
    select: { deviceId: true, channelType: true },
  });
  for (const { deviceId, channelType } of rows) {
    const types = result.get(deviceId)!;
    if (!types.includes(channelType)) types.push(channelType);
  }
  return result;
}
