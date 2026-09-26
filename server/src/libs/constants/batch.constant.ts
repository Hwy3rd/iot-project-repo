export enum BatchStatus {
  IN_STOCK = 'in_stock',
  EXPIRED = 'expired',
  REMOVED = 'removed',
}

// A batch still in the room whose expiry date falls within this many days
// (from today, business timezone) counts as "expiring soon" in the cold
// room inventory. Mirrored by the frontend's cold room detail screen.
export const EXPIRING_SOON_DAYS = 7;
