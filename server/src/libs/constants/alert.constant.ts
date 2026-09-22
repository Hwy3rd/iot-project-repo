// Single severity tier by design — there is no warning/critical split, every
// alert here is the same "needs attention" level. temperature_out_of_range
// covers both directions (see Alert.details.direction); temperature_predicted
// is the AI service's forecast, not a confirmed reading.
export enum AlertType {
  TEMPERATURE_OUT_OF_RANGE = 'temperature_out_of_range',
  TEMPERATURE_PREDICTED = 'temperature_predicted',
  DEVICE_FAULT = 'device_fault',
  OFFLINE = 'offline',
  DOOR_OPEN_TOO_LONG = 'door_open_too_long',
  BATCH_TEMPERATURE_OUT_OF_RANGE = 'batch_temperature_out_of_range',
  BATCH_EXPIRING_SOON = 'batch_expiring_soon',
}

export enum AlertStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

// Set only once resolved: distinguishes "the condition cleared on its own"
// from "a person closed it" for reporting.
export enum AlertResolution {
  AUTO = 'auto',
  MANUAL = 'manual',
}
