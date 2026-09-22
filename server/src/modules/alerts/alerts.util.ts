import { AlertType } from '../../libs/constants/alert.constant';

// Identifies "the incident this alert is about" — one active (open or
// acknowledged) row per (type, subject) at a time. `subjectId` is whichever
// of deviceId/batchId the alert is about; callers must pass exactly one.
// Enforced by a UNIQUE index that only sees non-null values (see the
// migration), so a second raise() for the same still-open incident collides
// instead of creating a duplicate — see AlertsService.raise().
export const buildActiveKey = (type: AlertType, subjectId: string): string =>
  `${type}:${subjectId}`;
