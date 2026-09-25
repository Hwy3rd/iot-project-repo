// Lifecycle of an attendance request (one work_shifts row):
//   pending ──approve──▶ approved   (Staff may work until the shift ends + grace)
//      │ ╲──reject───▶ rejected    (Staff may send a new request for the same shift)
//      ╰──shift ended─▶ expired     (nobody reviewed it in time; set by the sweep)
export enum WorkShiftStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

// Staff may send the request this long before the shift template's start.
export const CHECK_IN_EARLY_MINUTES = 15;

// After the shift ends, an approved Staff keeps their permissions this much
// longer before they're logged out (the frontend) and checked out (the sweep).
export const SHIFT_END_GRACE_MINUTES = 5;

// Shift templates store wall-clock times (06:00, 22:00…) of the business
// timezone, Asia/Ho_Chi_Minh — a fixed UTC+7 with no DST, so a constant
// offset is exact.
export const SHIFT_UTC_OFFSET_MINUTES = 7 * 60;
