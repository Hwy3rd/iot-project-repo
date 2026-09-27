import { refreshSession } from '@/api/client'
import type { ChatMessage } from '@/api/types'
import type { Socket } from 'socket.io-client'
import { getSocket } from './socket'

// Chatbot over the shared Socket.IO connection (docs/API_DESIGN.md §18.1).
// Server: CHATBOT_EVENTS in server/src/libs/constants/chatbot.constant.ts.
export const CHATBOT_EVENTS = {
  SEND: 'chatbot:send',
  MESSAGE: 'chatbot:message',
  TOOL_CALL: 'chatbot:tool_call',
  ERROR: 'chatbot:error',
} as const

export interface ChatToolCallEvent {
  conversationId: string
  tools: string[]
}

export interface ChatErrorEvent {
  conversationId: string
  message: string
}

type SendAck =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: { statusCode: number; message: string | string[] } }

/** Longest message the server accepts (CHATBOT_MESSAGE_MAX_LENGTH). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000

// The ack comes as soon as the message is stored, before the model runs.
const ACK_TIMEOUT_MS = 15_000

export class ChatSendError extends Error {
  readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

const SEND_ERROR_TEXT: Record<number, string> = {
  403: 'Bạn không được phân công vào kho đang chọn. Chọn kho khác ở đầu trang rồi gửi lại.',
  404: 'Cuộc trò chuyện không còn tồn tại.',
  409: 'Trợ lý đang trả lời tin nhắn trước, đợi một chút rồi gửi lại.',
  429: 'Bạn đã gửi quá nhiều tin nhắn. Thử lại sau ít phút.',
}

function emitSend(s: Socket, conversationId: string, content: string, warehouseId?: string): Promise<SendAck> {
  return new Promise((resolve, reject) => {
    s.timeout(ACK_TIMEOUT_MS).emit(
      CHATBOT_EVENTS.SEND,
      { conversationId, content, ...(warehouseId ? { warehouseId } : {}) },
      (err: Error | null, ack: SendAck) => (err ? reject(err) : resolve(ack)),
    )
  })
}

function reconnect(s: Socket): Promise<void> {
  return new Promise((resolve) => {
    s.once('connect', () => resolve())
    s.disconnect().connect()
  })
}

/**
 * Sends a message and resolves with it once stored; the reply then arrives
 * as CHATBOT_EVENTS.MESSAGE. The caller must hold the socket (holdSocket).
 * A socket outlives its access token, so on 401 the session is refreshed
 * and the socket reconnected before one retry.
 */
export async function sendChatMessage(
  conversationId: string,
  content: string,
  /** The header's warehouse: answers default to it. Omit for "Tất cả kho". */
  warehouseId?: string,
): Promise<ChatMessage> {
  const s = getSocket()
  let ack: SendAck
  try {
    ack = await emitSend(s, conversationId, content, warehouseId)
    if (!ack.ok && ack.error.statusCode === 401 && (await refreshSession()) === 'refreshed') {
      await reconnect(s)
      ack = await emitSend(s, conversationId, content, warehouseId)
    }
  } catch {
    throw new ChatSendError(0, 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.')
  }
  if (ack.ok) return ack.message
  const { statusCode, message } = ack.error
  throw new ChatSendError(
    statusCode,
    SEND_ERROR_TEXT[statusCode] ?? (Array.isArray(message) ? message.join(' ') : message),
  )
}

/** Only questions and final replies are shown; tool calls/results are the turn's internals. */
export const isShownMessage = (m: ChatMessage) =>
  (m.role === 'user' || m.role === 'assistant') && !!m.content?.trim()

// Tool names from server/src/modules/chatbot/tools/chatbot-tools.definitions.ts.
const TOOL_LABEL: Record<string, string> = {
  get_alerts: 'cảnh báo',
  get_alert_detail: 'chi tiết cảnh báo',
  get_devices: 'thiết bị',
  get_device_detail: 'chi tiết thiết bị',
  get_device_status_history: 'lịch sử trạng thái thiết bị',
  get_telemetry_hourly: 'nhiệt độ theo giờ',
  get_telemetry_raw: 'nhiệt độ tức thời',
  get_batches: 'lô hàng',
  get_batch_detail: 'chi tiết lô hàng',
  get_cold_rooms: 'phòng lạnh',
  get_cold_room_detail: 'chi tiết phòng lạnh',
  get_warehouses: 'kho',
  get_product_types: 'loại sản phẩm',
  get_commands: 'lệnh điều khiển',
  get_work_shifts: 'ca trực',
  get_system_health_summary: 'tình trạng hệ thống',
  get_inventory_summary: 'tồn kho',
  get_staff_performance_summary: 'hiệu suất nhân sự',
  get_previous_shift_summary: 'ca trước',
  search_docs: 'tài liệu hướng dẫn',
}

/** "Đang tra cứu cảnh báo, thiết bị…" for a tool_call event. */
export function toolActivityText(tools: readonly string[]) {
  const labels = [...new Set(tools.map((t) => TOOL_LABEL[t] ?? 'dữ liệu'))]
  return labels.length ? `Đang tra cứu ${labels.join(', ')}…` : 'Đang soạn câu trả lời…'
}

// The quick-chat window resumes its last conversation (per browser).
const QUICK_KEY = 'chatbot:quick-conversation'

export function readQuickConversation(): string | null {
  try {
    return localStorage.getItem(QUICK_KEY)
  } catch {
    return null
  }
}

export function writeQuickConversation(id: string | null) {
  try {
    if (id) localStorage.setItem(QUICK_KEY, id)
    else localStorage.removeItem(QUICK_KEY)
  } catch {
    // Not remembered; the window still works for this session.
  }
}
