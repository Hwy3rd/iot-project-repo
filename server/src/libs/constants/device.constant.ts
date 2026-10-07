export enum DeviceStatus {
  REGISTERED = 'registered',
  PROVISIONED = 'provisioned',
  ACTIVE = 'active',
  OFFLINE = 'offline',
  FAULT = 'fault',
  MAINTENANCE = 'maintenance',
  DECOMMISSIONED = 'decommissioned',
}

// Distinguishes a transition a person made (claim, decommission, put into
// maintenance) from one the system made on its own (heartbeat timeout,
// sensor fault detected) — see DeviceStatusHistory.
export enum DeviceStatusChangeTrigger {
  MANUAL = 'manual',
  AUTOMATED = 'automated',
}

// Fan supply faults the firmware reports (judged from the measured voltage):
//   no_power     — relay on, but the fan gets no power
//   low_voltage  — below 80% of the level measured once it had spun up
//   high_voltage — clearly above that level
//   stuck_on     — relay switched off, yet the fan still has power
export const FAN_FAULTS = [
  'no_power',
  'low_voltage',
  'high_voltage',
  'stuck_on',
] as const;
export type FanFault = (typeof FAN_FAULTS)[number];
