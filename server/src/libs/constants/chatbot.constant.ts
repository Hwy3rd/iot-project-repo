export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
  SYSTEM = 'system',
}

// Longest message a user may type in a single chat message — an input
// validation rule on CreateMessageDto only. It is not how LLM usage is
// bounded: that's LLM_MAX_OUTPUT_TOKENS (LlmService) plus the per-user
// ChatbotRateLimitGuard. Assistant replies and tool results are never
// length-limited by this.
export const CHATBOT_MESSAGE_MAX_LENGTH = 2000;

// How many of the most recent conversational messages (user messages and
// assistant text replies — tool rows of finished turns are never replayed,
// see ChatbotService.findRecentHistory) are sent to the LLM per turn:
// roughly the last 20 exchanges. Older context is dropped rather than
// letting a long conversation grow the request without bound.
export const CHATBOT_HISTORY_LIMIT = 40;

// Business timezone: "hôm nay"/"hôm qua" in a user's question mean
// Vietnam dates, not the server's (UTC in Docker).
export const CHATBOT_TIMEZONE = 'Asia/Ho_Chi_Minh';

// Server → client socket events, all sent to the user's own room
// (`user:{id}`, every open tab), never a shared one. Payloads:
//   MESSAGE   — a MessageResponseDto: the user's message once stored, then
//               the assistant's final reply (which also ends the turn).
//   TOOL_CALL — { conversationId, tools: string[] } while the assistant is
//               looking data up, for a "đang tra cứu…" indicator.
//   ERROR     — { conversationId, message } when a turn fails unexpectedly
//               after being accepted (LLM failures are a MESSAGE instead).
export const CHATBOT_EVENTS = {
  SEND: 'chatbot:send',
  MESSAGE: 'chatbot:message',
  TOOL_CALL: 'chatbot:tool_call',
  ERROR: 'chatbot:error',
} as const;

// One turn at a time per conversation (see ChatbotOrchestratorService):
// the lock's TTL only matters if the process dies mid-turn, so it just has
// to outlast the longest realistic turn (MAX_TOOL_ITERATIONS Gemini calls,
// each with its own SDK retries).
export const CHATBOT_TURN_LOCK_TTL_SECONDS = 180;
