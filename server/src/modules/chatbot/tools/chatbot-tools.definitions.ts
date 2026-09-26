import { AlertStatus, AlertType } from '../../../libs/constants/alert.constant';
import { BatchStatus } from '../../../libs/constants/batch.constant';
import { CommandStatus } from '../../../libs/constants/command.constant';
import { DeviceStatus } from '../../../libs/constants/device.constant';
import { MAX_PAGE_LIMIT } from '../../../libs/constants/pagination.constant';
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
  // Mirrors the @Roles of the REST route(s) exposing the same data. A
  // non-admin whose role is listed reaches the data of the warehouses
  // they're assigned to, same model as WarehouseScopeGuard — see
  // WarehouseAccessService.
  allowedRoles: UserRole[];
  // Mirrors the REST route's @WarehouseScope({ requireShift }): in a
  // warehouse where the caller acts as Staff, the data is only reachable
  // while they're checked into a shift there.
  requireShift?: boolean;
  scope: ChatbotToolScope;
}

// Paginated list tools return `{ items, meta: { page, limit, total,
// totalPages } }`, so the model can see there is more and ask for the next
// page instead of assuming the first page is everything.
const PAGINATION_PROPS = {
  page: { type: 'integer', minimum: 1, description: 'Trang (mặc định 1)' },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    description: 'Số bản ghi mỗi trang (mặc định 20)',
  },
};

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

// Lookup params take whatever the user said, not only ids — the executor
// resolves names/codes within the caller's own scope, so the model needn't
// list rooms/devices first just to find an id (one round trip less).
const WAREHOUSE_REF = {
  type: 'string',
  description: 'Kho: id, mã kho (vd "WH-HCM-01") hoặc tên kho',
};
const COLD_ROOM_REF = {
  type: 'string',
  description: 'Phòng lạnh: id hoặc tên phòng (vd "Phòng A1")',
};
const DEVICE_REF = {
  type: 'string',
  description: 'Thiết bị: id hoặc mã thiết bị uniqueId (vd "ESP32-A10000")',
};
const BATCH_REF = {
  type: 'string',
  description: 'Lô hàng: id hoặc mã lô (batchCode)',
};
const LIMIT_PROP = (max: number, fallback: number) => ({
  type: 'integer',
  minimum: 1,
  maximum: max,
  description: `Số bản ghi tối đa (mặc định ${fallback})`,
});

export const CHATBOT_TOOLS: ChatbotToolDefinition[] = [
  // ---------------------------------------------------------------------
  // Tra cứu trực tiếp 1 entity — wrap service hiện có
  // ---------------------------------------------------------------------

  {
    name: 'get_alerts',
    description:
      'Liệt kê cảnh báo (mới nhất trước), lọc theo trạng thái/loại/kho/phòng lạnh/thiết bị/lô hàng/khoảng ngày. Kết quả đã kèm tên phòng, mã kho, mã thiết bị. Chỉ cần số liệu tổng quan thì dùng get_system_health_summary.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: Object.values(AlertStatus) },
        type: { type: 'string', enum: Object.values(AlertType) },
        warehouseId: WAREHOUSE_REF,
        coldRoomId: COLD_ROOM_REF,
        deviceId: DEVICE_REF,
        batchId: BATCH_REF,
        createdFrom: { type: 'string', description: `Từ ngày — ${DATE_DESC}` },
        createdTo: { type: 'string', description: `Đến ngày — ${DATE_DESC}` },
        ...PAGINATION_PROPS,
      },
    },
    allowedRoles: ALL_ROLES,
    scope: 'coldRoomId',
  },
  {
    name: 'get_alert_detail',
    description: 'Lấy chi tiết 1 cảnh báo theo id (kèm details, người xử lý).',
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
    description:
      'Liệt kê thiết bị kèm trạng thái, lần heartbeat cuối, tên phòng và mã kho. Lọc theo kho/phòng lạnh/trạng thái — vd thiết bị mất kết nối: status="offline"; lỗi: status="fault".',
    input_schema: {
      type: 'object',
      properties: {
        warehouseId: WAREHOUSE_REF,
        coldRoomId: COLD_ROOM_REF,
        status: { type: 'string', enum: Object.values(DeviceStatus) },
        limit: LIMIT_PROP(200, 50),
      },
    },
    allowedRoles: ALL_ROLES,
    requireShift: true,
    scope: 'coldRoomId',
  },
  {
    name: 'get_device_detail',
    description:
      'Chi tiết 1 thiết bị: trạng thái, firmware, lần heartbeat cuối, phòng lạnh đang gắn.',
    input_schema: {
      type: 'object',
      properties: { deviceId: DEVICE_REF },
      required: ['deviceId'],
    },
    allowedRoles: ALL_ROLES,
    requireShift: true,
    scope: 'deviceId',
  },
  {
    name: 'get_device_status_history',
    description: 'Lịch sử chuyển trạng thái của 1 thiết bị (mới nhất trước).',
    input_schema: {
      type: 'object',
      properties: { deviceId: DEVICE_REF, ...PAGINATION_PROPS },
      required: ['deviceId'],
    },
    allowedRoles: DEVICE_LOG_ROLES,
    scope: 'deviceId',
  },
  {
    name: 'get_telemetry_hourly',
    description:
      'Nhiệt độ/cửa tổng hợp theo giờ (avg/min/max nhiệt độ, số lần mở cửa...) trong khoảng thời gian (mặc định 24 giờ qua). Truyền coldRoomId để lấy cho mọi thiết bị trong phòng, hoặc deviceId cho 1 thiết bị.',
    input_schema: {
      type: 'object',
      properties: {
        coldRoomId: COLD_ROOM_REF,
        deviceId: DEVICE_REF,
        from: { type: 'string', description: DATE_DESC },
        to: { type: 'string', description: DATE_DESC },
      },
    },
    allowedRoles: ALL_ROLES,
    requireShift: true,
    scope: 'deviceId',
  },
  {
    name: 'get_telemetry_raw',
    description:
      'Mẫu cảm biến thô gần nhất (chỉ giữ trong thời gian ngắn, không dùng tra lịch sử xa). Truyền coldRoomId (mọi thiết bị trong phòng) hoặc deviceId. Chỉ cần nhiệt độ hiện tại của phòng thì dùng get_cold_room_detail.',
    input_schema: {
      type: 'object',
      properties: {
        coldRoomId: COLD_ROOM_REF,
        deviceId: DEVICE_REF,
        from: { type: 'string', description: DATE_DESC },
        to: { type: 'string', description: DATE_DESC },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
    allowedRoles: DEVICE_LOG_ROLES,
    scope: 'deviceId',
  },
  {
    name: 'get_batches',
    description:
      'Liệt kê lô hàng (hạn dùng gần nhất trước) kèm loại sản phẩm, số lượng, tên phòng, mã kho. Lọc theo kho/phòng lạnh/trạng thái; expiringWithinDays để tìm lô còn trong kho sắp hết hạn.',
    input_schema: {
      type: 'object',
      properties: {
        warehouseId: WAREHOUSE_REF,
        coldRoomId: COLD_ROOM_REF,
        status: { type: 'string', enum: Object.values(BatchStatus) },
        expiringWithinDays: {
          type: 'integer',
          minimum: 0,
          maximum: 365,
          description:
            'Chỉ lô đang trong kho có hạn dùng trong N ngày tới (kể cả đã quá hạn)',
        },
        limit: LIMIT_PROP(200, 50),
      },
    },
    allowedRoles: BATCH_ROLES,
    scope: 'coldRoomId',
  },
  {
    name: 'get_batch_detail',
    description:
      'Chi tiết 1 lô hàng: số lượng, ngày nhập, hạn dùng, nhà cung cấp, ghi chú.',
    input_schema: {
      type: 'object',
      properties: { batchId: BATCH_REF },
      required: ['batchId'],
    },
    allowedRoles: BATCH_ROLES,
    scope: 'batchId',
  },
  {
    name: 'get_cold_rooms',
    description:
      'Liệt kê phòng lạnh kèm mã kho và ngưỡng nhiệt độ (tempMin/tempMax), lọc theo kho. Không có số liệu hiện tại — dùng get_system_health_summary hoặc get_cold_room_detail.',
    input_schema: {
      type: 'object',
      properties: { warehouseId: WAREHOUSE_REF },
    },
    allowedRoles: ALL_ROLES,
    scope: 'warehouseId',
  },
  {
    name: 'get_cold_room_detail',
    description:
      'Chi tiết 1 phòng lạnh kèm trạng thái hiện tại: nhiệt độ mới nhất, cửa, lỗi cảm biến, có vượt ngưỡng không, số thiết bị theo trạng thái, số cảnh báo chưa xử lý, cùng ngưỡng cấu hình.',
    input_schema: {
      type: 'object',
      properties: { coldRoomId: COLD_ROOM_REF },
      required: ['coldRoomId'],
    },
    allowedRoles: ALL_ROLES,
    scope: 'coldRoomId',
  },
  {
    name: 'get_warehouses',
    description:
      'Liệt kê kho (mã, tên, địa chỉ, số phòng lạnh) — tự động chỉ trả về kho user được gán (Admin thấy tất cả).',
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
    description:
      'Lịch sử lệnh điều khiển đã gửi tới thiết bị (mới nhất trước), kèm mã thiết bị và kênh.',
    input_schema: {
      type: 'object',
      properties: {
        deviceId: DEVICE_REF,
        status: { type: 'string', enum: Object.values(CommandStatus) },
        limit: LIMIT_PROP(100, 20),
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
      'Lịch ca trực / chấm công (mới nhất trước). Staff chỉ xem được ca của chính mình; Manager/Admin xem theo kho.',
    input_schema: {
      type: 'object',
      properties: {
        warehouseId: WAREHOUSE_REF,
        staffId: { type: 'string' },
        date: { type: 'string', description: DATE_DESC },
        limit: LIMIT_PROP(200, 50),
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
      'Tổng quan hiện tại trong 1 lần gọi: số kho/phòng, thiết bị theo trạng thái, cảnh báo chưa xử lý theo loại, các phòng cần chú ý (vượt ngưỡng, cửa mở, lỗi cảm biến, mất tín hiệu, thiết bị hỏng, có cảnh báo) và danh sách thiết bị offline/lỗi/bảo trì. Ưu tiên dùng cho câu hỏi "tình hình thế nào", "có gì bất thường", "thiết bị nào mất kết nối".',
    input_schema: {
      type: 'object',
      properties: { warehouseId: WAREHOUSE_REF },
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
