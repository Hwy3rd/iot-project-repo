// Where a route's target warehouseId is resolved from, for WarehouseScopeGuard.
// Each source names the entity chain walked to reach `cold_room.warehouse_id`
// (or the warehouse id itself). See common/guards/warehouse-scope.guard.ts.
export enum WarehouseScopeSource {
  WAREHOUSE_PARAM = 'warehouse_param', // route param IS the warehouseId
  WAREHOUSE_BODY = 'warehouse_body', // body field IS the warehouseId
  COLD_ROOM_PARAM = 'cold_room_param', // route param is a coldRoomId
  COLD_ROOM_BODY = 'cold_room_body', // body field is a coldRoomId
  DEVICE_PARAM = 'device_param', // route param is a deviceId -> coldRoom
  BATCH_PARAM = 'batch_param', // route param is a batchId -> coldRoom
  ALERT_PARAM = 'alert_param', // route param is an alertId -> coldRoom
  COMMAND_PARAM = 'command_param', // route param is a commandId -> channel -> device -> coldRoom
  CHANNEL_BODY = 'channel_body', // body field is a channelId -> device -> coldRoom
  WORK_SHIFT_PARAM = 'work_shift_param', // route param is a workShiftId
}
