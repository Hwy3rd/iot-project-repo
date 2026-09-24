import { AlertStatus, AlertType } from '../../../libs/constants/alert.constant';
import { BatchStatus } from '../../../libs/constants/batch.constant';
import { CommandStatus } from '../../../libs/constants/command.constant';
import { UserRole } from '../../../libs/constants/user.constant';

// Generic tool-calling schema — `name`/`description`/`input_schema` (plain
// JSON Schema) are sent to the LLM verbatim, currently mapped to Gemini's
// `parametersJsonSchema` field in ChatbotOrchestratorService — plus our own
// access-control metadata layered on top for ChatbotToolExecutorService.
//
// `scope` tells the executor which input field, if any, identifies the
// warehouse-scoped resource this tool reads. Guards (`WarehouseScopeGuard`)
// only run on the HTTP pipeline — calling a service directly from a tool
// executor bypasses them entirely — so the executor MUST re-derive and
// enforce scope itself using this field before calling the wrapped
// service, never trusting the LLM-supplied id alone:
//   - 'warehouseId' | 'coldRoomId' | 'deviceId' | 'batchId': if the LLM
//     supplied that param, verify it resolves to a warehouse the caller is
//     assigned to; if omitted, the executor restricts the query to the
//     caller's assigned warehouse set instead of running it unscoped.
//   - 'self': inherently scoped to the calling user (their own id is
//     injected server-side); the LLM is never given a user/staff id param
//     to choose who it reads.
//   - 'none': not warehouse-scoped data at all (e.g. product types).
export type ChatbotToolScope =
  'warehouseId' | 'coldRoomId' | 'deviceId' | 'batchId' | 'self' | 'none';

export interface ChatbotToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Mirrors the @Roles of the REST route(s) exposing the same data. For a
  // non-admin these are matched against their role *in each warehouse*
  // (warehouse_staff.role), same model as WarehouseScopeGuard — see
  // WarehouseAccessService.
  allowedRoles: UserRole[];
  // Mirrors the REST route's @WarehouseScope({ requireShift }): in a
  // warehouse where the caller acts as Staff, the data is only reachable
  // while they're checked into a shift there.
  requireShift?: boolean;
  scope: ChatbotToolScope;
}

const ALL_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
  UserRole.STAFF,
];

const MANAGEMENT_ROLES = [UserRole.ADMIN, UserRole.MANAGER];
// Detailed device logs (status history, raw telemetry) — docs/RBAC.md:
// Staff only gets basic alerts, not device logs.
const DEVICE_LOG_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
];
// Batches are stock operations — Technician has no part in them.
const BATCH_ROLES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF];
// Shift scheduling — Technician has no access (docs/RBAC.md).
const WORK_SHIFT_ROLES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF];

const DATE_DESC = 'Định dạng ISO date (YYYY-MM-DD) hoặc datetime ISO 8601';

export const CHATBOT_TOOLS: ChatbotToolDefinition[] = [
  // ---------------------------------------------------------------------
  // Tra cứu trực tiếp 1 entity — wrap service hiện có
  // ---------------------------------------------------------------------

  {
    name: 'get_alerts',
    description:
      'Liệt kê cảnh báo, lọc theo trạng thái/loại/phòng lạnh/thiết bị/lô hàng. Dùng khi user hỏi có cảnh báo gì đang mở, lịch sử cảnh báo.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: Object.values(AlertStatus) },
        type: { type: 'string', enum: Object.values(AlertType) },
        coldRoomId: { type: 'string', description: 'Lọc theo phòng lạnh' },
        deviceId: { type: 'string', description: 'Lọc theo thiết bị' },
        batchId: { type: 'string', description: 'Lọc theo lô hàng' },
      },
    },
    allowedRoles: ALL_ROLES,
    scope: 'coldRoomId',
  },
  {
    name: 'get_alert_detail',
    description: 'Lấy chi tiết 1 cảnh báo theo id.',
    input_schema: {
      type: 'object',
      properties: { alertId: { type: 'string' } },
      required: ['alertId'],
    },
    allowedRoles: ALL_ROLES,
    scope: 'none', // scope thực tế được suy ra sau khi load alert, không phải từ input
  },
  {
    name: 'get_devices',
    description: 'Liệt kê thiết bị, có thể lọc theo phòng lạnh.',
    input_schema: {
      type: 'object',
      properties: {
        coldRoomId: { type: 'string' },
      },
    },
    allowedRoles: ALL_ROLES,
    requireShift: true,
    scope: 'coldRoomId',
  },
  {
    name: 'get_device_detail',
    description:
      'Chi tiết 1 thiết bị: trạng thái, firmware, last_heartbeat_at, phòng lạnh đang gắn.',
    input_schema: {
      type: 'object',
      properties: { deviceId: { type: 'string' } },
      required: ['deviceId'],
    },
    allowedRoles: ALL_ROLES,
    requireShift: true,
    scope: 'deviceId',
  },
  {
    name: 'get_device_status_history',
    description: 'Lịch sử chuyển trạng thái của 1 thiết bị.',
    input_schema: {
      type: 'object',
      properties: { deviceId: { type: 'string' } },
      required: ['deviceId'],
    },
    allowedRoles: DEVICE_LOG_ROLES,
    scope: 'deviceId',
  },
  {
    name: 'get_telemetry_hourly',
    description:
      'Số liệu nhiệt độ/cửa tổng hợp theo giờ (avg/min/max_temperature, door_open_count...) của 1 thiết bị trong khoảng thời gian.',
    input_schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        from: { type: 'string', description: DATE_DESC },
        to: { type: 'string', description: DATE_DESC },
      },
      required: ['deviceId'],
    },
    allowedRoles: ALL_ROLES,
    requireShift: true,
    scope: 'deviceId',
  },
  {
    name: 'get_telemetry_raw',
    description:
      'Dữ liệu cảm biến thô gần nhất của 1 thiết bị (lưu ý: chỉ giữ trong thời gian ngắn theo TTL, không dùng để tra cứu lịch sử xa).',
    input_schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        from: { type: 'string', description: DATE_DESC },
        to: { type: 'string', description: DATE_DESC },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['deviceId'],
    },
    allowedRoles: DEVICE_LOG_ROLES,
    scope: 'deviceId',
  },
  {
    name: 'get_batches',
    description: 'Liệt kê lô hàng, lọc theo phòng lạnh/trạng thái.',
    input_schema: {
      type: 'object',
      properties: {
        coldRoomId: { type: 'string' },
        status: { type: 'string', enum: Object.values(BatchStatus) },
      },
    },
    allowedRoles: BATCH_ROLES,
    scope: 'coldRoomId',
  },
  {
    name: 'get_batch_detail',
    description:
      'Chi tiết 1 lô hàng: khối lượng/số lượng, ngày nhập, hạn dùng, nhà cung cấp.',
    input_schema: {
      type: 'object',
      properties: { batchId: { type: 'string' } },
      required: ['batchId'],
    },
    allowedRoles: BATCH_ROLES,
    scope: 'batchId',
  },
  {
    name: 'get_cold_rooms',
    description: 'Liệt kê phòng lạnh và ngưỡng nhiệt độ, lọc theo kho.',
    input_schema: {
      type: 'object',
      properties: { warehouseId: { type: 'string' } },
    },
    allowedRoles: ALL_ROLES,
    scope: 'warehouseId',
  },
  {
    name: 'get_cold_room_detail',
    description:
      'Chi tiết 1 phòng lạnh: temp_min/max/hysteresis, door_open_max_seconds.',
    input_schema: {
      type: 'object',
      properties: { coldRoomId: { type: 'string' } },
      required: ['coldRoomId'],
    },
    allowedRoles: ALL_ROLES,
    scope: 'coldRoomId',
  },
  {
    name: 'get_warehouses',
    description:
      'Liệt kê kho — tự động chỉ trả về kho user được gán (Admin thấy tất cả).',
    input_schema: { type: 'object', properties: {} },
    allowedRoles: ALL_ROLES,
    scope: 'none', // lọc theo user_assignments ngay trong executor, không qua param
  },
  {
    name: 'get_product_types',
    description:
      'Liệt kê loại sản phẩm và ngưỡng nhiệt độ khuyến nghị — dữ liệu dùng chung, không gắn theo kho.',
    input_schema: { type: 'object', properties: {} },
    allowedRoles: ALL_ROLES,
    scope: 'none',
  },
  {
    name: 'get_commands',
    // Resolved via Command.channelId -> DeviceChannel.deviceId in the
    // executor (Command has no direct deviceId column), not through
    // CommandsService — see chatbot-tool-executor.service.ts.
    description: 'Lịch sử lệnh điều khiển đã gửi tới thiết bị.',
    input_schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        status: { type: 'string', enum: Object.values(CommandStatus) },
      },
    },
    allowedRoles: ALL_ROLES,
    scope: 'deviceId',
  },
  {
    name: 'get_work_shifts',
    // Staff bị executor ép staffId = chính họ bất kể LLM truyền gì (xem
    // chatbot-tool-executor.service.ts).
    description:
      'Lịch ca trực. Staff chỉ xem được ca của chính mình; Manager/Admin xem theo kho.',
    input_schema: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string' },
        staffId: { type: 'string' },
        date: { type: 'string', description: DATE_DESC },
      },
    },
    allowedRoles: WORK_SHIFT_ROLES,
    scope: 'warehouseId',
  },

  // ---------------------------------------------------------------------
  // Tổng hợp / phân tích — logic mới, chưa có service tương ứng
  // ---------------------------------------------------------------------

  {
    name: 'get_system_health_summary',
    description:
      'Tổng quan tình trạng hệ thống: tỷ lệ thiết bị online/offline, số cảnh báo đang mở theo loại, phòng lạnh nào đang vượt ngưỡng.',
    input_schema: {
      type: 'object',
      properties: { warehouseId: { type: 'string' } },
    },
    allowedRoles: ALL_ROLES,
    scope: 'warehouseId',
  },
  {
    name: 'get_inventory_summary',
    description:
      'Tổng hợp sản lượng nhập/xuất/tồn theo loại sản phẩm trong khoảng thời gian (group theo product_type vì đơn vị đo khác nhau, không cộng dồn trực tiếp). Không bao gồm doanh số/giá trị — hệ thống chưa lưu dữ liệu giá.',
    input_schema: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string' },
        coldRoomId: { type: 'string' },
        from: { type: 'string', description: DATE_DESC },
        to: { type: 'string', description: DATE_DESC },
      },
      required: ['from', 'to'],
    },
    allowedRoles: MANAGEMENT_ROLES,
    scope: 'warehouseId',
  },
  {
    name: 'get_staff_performance_summary',
    description:
      'Chỉ số hiệu suất nhân viên: thời gian phản hồi cảnh báo trung bình, tỷ lệ check-in ca đúng giờ. Dữ liệu đánh giá người khác — chỉ Manager/Admin được xem, Staff không tự truy vấn được kể cả về chính mình.',
    input_schema: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string' },
        staffId: { type: 'string' },
        from: { type: 'string', description: DATE_DESC },
        to: { type: 'string', description: DATE_DESC },
      },
      required: ['from', 'to'],
    },
    allowedRoles: MANAGEMENT_ROLES,
    scope: 'warehouseId',
  },
  {
    name: 'get_previous_shift_summary',
    description:
      'Tóm tắt ca trực gần nhất đã kết thúc của chính người đang hỏi: cảnh báo phát sinh, số lần/thời gian mở cửa, lô hàng nhập/xuất trong ca đó.',
    input_schema: { type: 'object', properties: {} }, // không có tham số — luôn tự suy ra từ user đang đăng nhập
    allowedRoles: ALL_ROLES,
    scope: 'self',
  },
  {
    name: 'search_docs',
    // Whitelisted to exactly 3 business-facing docs (see
    // CHATBOT_SEARCHABLE_DOCS in chatbot-tool-executor.service.ts) —
    // deliberately excludes internal engineering docs (ARCHITECTURE,
    // DATABASE_DESIGN, RBAC, API_DESIGN...) so the chatbot can never
    // surface implementation details through this tool, per system-prompt
    // rule #5.
    description:
      'Tìm kiếm trong tài liệu nghiệp vụ/quy trình vận hành/xử lý sự cố của hệ thống theo từ khoá, trả về đoạn nội dung khớp kèm tên file.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    allowedRoles: ALL_ROLES,
    scope: 'none',
  },
];
