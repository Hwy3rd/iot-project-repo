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
