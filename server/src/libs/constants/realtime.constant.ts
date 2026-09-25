// Warehouse-room events pushed by RealtimeGateway.emitToWarehouse(). Every
// socket in `warehouse:{id}` gets them — i.e. anyone assigned to that
// warehouse, whatever their role there or whether they're on shift (the
// same audience as GET /cold-rooms/status).
export const REALTIME_EVENTS = {
  // A new telemetry sample was stored. Payload: ColdRoomReadingEvent.
  COLD_ROOM_READING: 'coldroom:reading',
  // An alert of the room was opened, acknowledged or resolved. Payload:
  // { warehouseId, coldRoomId } — clients refetch what they show.
  ALERTS_CHANGED: 'alerts:changed',
} as const;

export interface ColdRoomReadingEvent {
  warehouseId: string;
  coldRoomId: string;
  deviceId: string;
  // Same shape as ColdRoomStatus.latest from GET /cold-rooms/status.
  latest: {
    ts: Date;
    temperature: number | null;
    doorOpen: boolean;
    sensorFault: boolean;
    outOfRange: boolean;
  };
}
