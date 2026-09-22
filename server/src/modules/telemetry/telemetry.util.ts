import { HOUR_MS } from '../../libs/constants/telemetry.constant';

export const floorToHour = (date: Date): Date =>
  new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
