import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  HOUR_MS,
  TELEMETRY_HOURLY_COLLECTION,
  TELEMETRY_ROLLUP_LOOKBACK_HOURS,
} from '../../libs/constants/telemetry.constant';
import { TelemetryRaw } from './schemas/telemetry-raw.schema';
import { floorToHour } from './telemetry.util';

@Injectable()
export class TelemetryRollupService {
  constructor(
    @InjectModel(TelemetryRaw.name)
    private readonly rawModel: Model<TelemetryRaw>,
  ) {}

  // Re-aggregates the last few *closed* hours (the hour in progress is skipped).
  // Idempotent, so running it every hour with overlapping windows is fine.
  async rollupRecentHours(now: Date = new Date()) {
    const currentHour = floorToHour(now).getTime();
    for (let i = TELEMETRY_ROLLUP_LOOKBACK_HOURS; i >= 1; i--) {
      await this.rollupHour(new Date(currentHour - i * HOUR_MS));
    }
  }

  // Runs entirely inside MongoDB: group the hour's raw samples per device and
  // `$merge` the result into telemetry_hourly, replacing an existing bucket.
  // Re-running an hour therefore recomputes it from raw rather than adding to
  // it, so retries and duplicate runs cannot double count. If the raw samples
  // for the hour have already expired, nothing matches and the existing
  // bucket is left untouched.
  async rollupHour(hour: Date) {
    const start = floorToHour(hour);
    const end = new Date(start.getTime() + HOUR_MS);

    await this.rawModel
      .aggregate([
        { $match: { ts: { $gte: start, $lt: end } } },
        // Ordered so `$last` below is the newest sample; the sort is served by
        // the same `ts` index as the match.
        { $sort: { ts: 1 } },
        {
          $group: {
            _id: '$deviceId',
            coldRoomId: { $last: '$coldRoomId' },
            sampleCount: {
              $sum: { $cond: [{ $isNumber: '$temperature' }, 1, 0] },
            },
            // $avg/$min/$max skip nulls and yield null when every value is
            // null — an hour with only sensor errors gets nulls, not zeros.
            avgTemp: { $avg: '$temperature' },
            minTemp: { $min: '$temperature' },
            maxTemp: { $max: '$temperature' },
            outOfRangeCount: { $sum: { $cond: ['$outOfRange', 1, 0] } },
            sensorErrorCount: { $sum: { $cond: ['$sensorFault', 1, 0] } },
          },
        },
        {
          // No `_id`: `$merge` matches on (deviceId, hourBucket), and a
          // pipeline-supplied `_id` that differs from the stored one is an error.
          $project: {
            _id: 0,
            deviceId: '$_id',
            coldRoomId: 1,
            hourBucket: { $literal: start },
            sampleCount: 1,
            avgTemp: 1,
            minTemp: 1,
            maxTemp: 1,
            outOfRangeCount: 1,
            sensorErrorCount: 1,
            computedAt: '$$NOW',
          },
        },
        {
          $merge: {
            into: TELEMETRY_HOURLY_COLLECTION,
            on: ['deviceId', 'hourBucket'],
            whenMatched: 'replace',
            whenNotMatched: 'insert',
          },
        },
      ])
      .exec();
  }
}
