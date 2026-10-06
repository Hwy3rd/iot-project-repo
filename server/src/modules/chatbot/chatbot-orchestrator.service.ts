import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ApiError,
  Content,
  createModelContent,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  createUserContent,
  FunctionDeclaration,
  Part,
} from '@google/genai';
import { plainToInstance } from 'class-transformer';
import type { Redis } from 'ioredis';
import { LlmService } from '../../libs/llm/llm.service';
import {
  CHATBOT_EVENTS,
  CHATBOT_HISTORY_LIMIT,
  CHATBOT_TIMEZONE,
  CHATBOT_TOOL_RESULT_MAX_BYTES,
  CHATBOT_TURN_TOOL_RESULTS_MAX_BYTES,
  CHATBOT_TURN_LOCK_TTL_SECONDS,
  MessageRole,
} from '../../libs/constants/chatbot.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatbotService } from './chatbot.service';
import {
  ChatbotTurnDeadline,
  ChatbotTurnTimeoutError,
} from './chatbot-turn-deadline';
import {
  buildChatbotSystemInstruction,
  ChatbotWorkingWarehouse,
} from './chatbot-system-prompt.constant';
import { MessageResponseDto } from './dto/message-response.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { CHATBOT_TOOLS } from './tools/chatbot-tools.definitions';
import {
  CHATBOT_TOOLS_NOT_IMPLEMENTED,
  ChatbotToolCaller,
  ChatbotToolExecutorService,
} from './tools/chatbot-tool-executor.service';

// Hard cap on how many tool-call round-trips one user message can trigger
// before the turn is forced to end with a fallback reply. Protects against
// the model getting stuck in a call-tool-then-call-again loop, which would
// otherwise burn the same free-tier Gemini quota discussed elsewhere in
// this module on a single stuck conversation turn.
const MAX_TOOL_ITERATIONS = 5;

const LLM_QUOTA_MESSAGE =
  'Trợ lý đang tạm hết lượt xử lý (vượt hạn mức dịch vụ AI). Bạn vui lòng thử lại sau ít phút nhé.';
const TURN_FAILED_MESSAGE =
  'Xin lỗi, đã có lỗi khi xử lý tin nhắn. Bạn vui lòng thử lại.';
const LLM_UNAVAILABLE_MESSAGE =
  'Xin lỗi, trợ lý tạm thời không phản hồi được. Bạn vui lòng thử lại sau.';

const TURN_TIMEOUT_MESSAGE =
  'Trợ lý mất quá nhiều thời gian để xử lý câu hỏi này. Bạn vui lòng thử lại hoặc hỏi trong phạm vi nhỏ hơn.';
const EMPTY_REPLY_MESSAGE =
  'Trợ lý chưa nhận được câu trả lời có nội dung từ dịch vụ AI. Bạn vui lòng thử lại hoặc diễn đạt câu hỏi khác.';

const turnLockKey = (conversationId: string) =>
  `chatbot:turn:${conversationId}`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

// A stale turn must not emit an error that clears a newer turn's UI state.
class ChatbotTurnLockLostError extends ConflictException {}

export interface ChatbotTurn {
  userMessage: Message;
  // Settles with the assistant's final reply (already emitted as
  // CHATBOT_EVENTS.MESSAGE); rejects only on an unexpected failure (already
  // emitted as CHATBOT_EVENTS.ERROR).
  completion: Promise<Message>;
}

// Ties ChatbotService (persistence), LlmService (Gemini) and
// ChatbotToolExecutorService (RBAC-checked tool dispatch) into the actual
// conversation loop: persist the user's turn, replay history to the model,
// and on every function-call response execute the tool, persist both the
// call and its result, and feed the result back — repeating until the
// model answers in plain text or MAX_TOOL_ITERATIONS is hit. Progress and
// the reply are pushed to the user's sockets (RealtimeGateway.emitToUser)
// whichever transport the message came in on.
@Injectable()
export class ChatbotOrchestratorService {
  private readonly logger = new Logger(ChatbotOrchestratorService.name);

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly llmService: LlmService,
    private readonly toolExecutor: ChatbotToolExecutorService,
    private readonly realtime: RealtimeGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Accepts one user message: checks ownership, takes the conversation's
  // turn lock, stores the message and broadcasts it, then starts the
  // model/tool loop without waiting for it. Anything thrown from here
  // (404 conversation, 409 turn already running) means nothing was stored.
  //
  // `warehouseId` is the warehouse picked in the app header (optional):
  // answers default to it. One the caller isn't assigned to is a 403.
  //
  // One turn at a time per conversation: two overlapping turns (double
  // send, two tabs) would each read history without the other's messages
  // and interleave their rows, leaving a history the model can't follow.
  async startTurn(
    conversationId: string,
    caller: ChatbotToolCaller,
    content: string,
    warehouseId?: string,
  ): Promise<ChatbotTurn> {
    const conversation = await this.chatbotService.findConversation(
      conversationId,
      caller.id,
    );
    const working = warehouseId
      ? await this.toolExecutor.resolveWorkingWarehouse(caller, warehouseId)
      : null;
    const lockToken = await this.acquireTurnLock(conversationId);
    const deadline = new ChatbotTurnDeadline();

    let userMessage: Message;
    try {
      userMessage = await this.chatbotService.addUserMessage(
        conversationId,
        caller.id,
        { content },
      );
    } catch (error) {
      deadline.dispose();
      await this.releaseTurnLock(conversationId, lockToken);
      throw error;
    }
    this.emitMessage(caller.id, userMessage);

    const completion = this.runTurn(
      conversation,
      { ...caller, workingWarehouseId: working?.id },
      working,
      deadline,
      lockToken,
    )
      .then(async (reply) => {
        await this.assertTurnLockOwned(conversationId, lockToken);
        this.emitMessage(caller.id, reply);
        return reply;
      })
      .catch((error: unknown) => {
        if (error instanceof ChatbotTurnLockLostError) {
          this.logger.warn(
            'Discarded a chatbot turn that no longer owns its lease.',
          );
          throw error;
        }
        this.logger.error(
          `Chatbot turn failed for conversation ${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        );
        this.realtime.emitToUser(caller.id, CHATBOT_EVENTS.ERROR, {
          conversationId,
          message: TURN_FAILED_MESSAGE,
        });
        throw error;
      })
      .finally(async () => {
        deadline.dispose();
        await this.releaseTurnLock(conversationId, lockToken);
      });

    return { userMessage, completion };
  }

  // REST path (POST :id/messages): same turn, but answered only once the
  // reply exists. Its events still go out, so the sender's other tabs stay
  // in sync.
  async sendMessage(
    conversationId: string,
    caller: ChatbotToolCaller,
    content: string,
    warehouseId?: string,
  ): Promise<Message> {
    const turn = await this.startTurn(
      conversationId,
      caller,
      content,
      warehouseId,
    );
    return turn.completion;
  }

  private async runTurn(
    conversation: Conversation,
    caller: ChatbotToolCaller,
    workingWarehouse: ChatbotWorkingWarehouse | null,
    deadline: ChatbotTurnDeadline,
    lockToken: string,
  ): Promise<Message> {
    try {
      return await this.runTurnLoop(
        conversation,
        caller,
        workingWarehouse,
        deadline,
        lockToken,
      );
    } catch (error) {
      if (!(error instanceof ChatbotTurnTimeoutError)) throw error;
      // This terminal write runs after cancellation. Late model/tool results
      // have no continuation into this loop and cannot append another reply.
      await this.assertTurnLockOwned(conversation.id, lockToken);
      return this.chatbotService.appendAssistantMessage(
        conversation,
        TURN_TIMEOUT_MESSAGE,
      );
    }
  }

  private async runTurnLoop(
    conversation: Conversation,
    caller: ChatbotToolCaller,
    workingWarehouse: ChatbotWorkingWarehouse | null,
    deadline: ChatbotTurnDeadline,
    lockToken: string,
  ): Promise<Message> {
    const conversationId = conversation.id;
    const history = await deadline.wait(() =>
      this.chatbotService.findRecentHistory(
        conversationId,
        CHATBOT_HISTORY_LIMIT,
      ),
    );
    let toolResultBytes = 0;
    const contents: Content[] = mergeConsecutiveRoles(
      history.map((message) => this.toGeminiContent(message)),
    );
    const toolDeclarations = this.toolDeclarationsFor(caller);
    const systemInstruction = buildChatbotSystemInstruction(
      new Date(),
      CHATBOT_TIMEZONE,
      workingWarehouse,
    );

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let response: Awaited<ReturnType<LlmService['generateContent']>>;
      try {
        response = await deadline.wait(() =>
          this.llmService.generateContent({
            contents,
            config: {
              systemInstruction,
              abortSignal: deadline.signal,
              tools:
                toolDeclarations.length > 0
                  ? [{ functionDeclarations: toolDeclarations }]
                  : undefined,
            },
          }),
        );
      } catch (error) {
        deadline.assertActive();
        // Reached only after LlmService's own retries gave up (quota
        // exhausted, Gemini down, network). End the turn with a visible
        // reply instead of a 500: the user's message is already stored,
        // and a closing assistant row keeps the history well-formed even
        // if this failed mid tool-loop (after a tool result).
        await deadline.wait(() =>
          this.assertTurnLockOwned(conversationId, lockToken),
        );
        return this.endTurnWithLlmFailure(conversation, error);
      }

      const modelContent = response.candidates?.[0]?.content;
      // Read text from the parts directly: `response.text` logs an SDK
      // warning whenever function-call parts are present too. Thought
      // parts (the model's internal reasoning) are never user-facing.
      const text = extractText(modelContent);

      const functionCalls = response.functionCalls ?? [];
      if (functionCalls.length === 0) {
        await deadline.wait(() =>
          this.assertTurnLockOwned(conversationId, lockToken),
        );
        return this.chatbotService.appendAssistantMessage(
          conversation,
          text?.trim() ? text : EMPTY_REPLY_MESSAGE,
        );
      }

      const toolCalls = functionCalls.map((call) => ({
        // Gemini may omit ids; ours only keys the stored TOOL rows.
        id: call.id ?? randomUUID(),
        // Echoed back on the functionResponse only if Gemini set one.
        modelCallId: call.id,
        name: call.name ?? '',
        arguments: call.args ?? {},
      }));
      await deadline.wait(() =>
        this.assertTurnLockOwned(conversationId, lockToken),
      );
      await this.chatbotService.appendAssistantMessage(
        conversation,
        text,
        toolCalls.map(({ id, name, arguments: args }) => ({
          id,
          name,
          arguments: args,
        })),
      );
      // Replay the model's own content verbatim — not rebuilt from the
      // parsed calls. Thinking models (Gemini 3.x) attach a
      // `thoughtSignature` to function-call parts and reject the follow-up
      // request (400 INVALID_ARGUMENT) if it doesn't come back unchanged.
      // See https://ai.google.dev/gemini-api/docs/thought-signatures
      contents.push(
        modelContent ??
          createModelContent(
            toolCalls.map((call) =>
              createPartFromFunctionCall(call.name, call.arguments),
            ),
          ),
      );

      deadline.assertActive();
      this.realtime.emitToUser(caller.id, CHATBOT_EVENTS.TOOL_CALL, {
        conversationId,
        tools: toolCalls.map((call) => call.name),
      });

      // The calls of one step are independent reads — run them together,
      // then store/replay the results in the model's order.
      const execResults = await deadline.wait(() =>
        Promise.all(
          toolCalls.map((call) =>
            this.toolExecutor.execute(call.name, call.arguments, caller),
          ),
        ),
      );
      const responseParts: Part[] = [];
      for (const [index, call] of toolCalls.entries()) {
        const execResult = execResults[index];
        let payload: Record<string, unknown> = execResult.error
          ? { error: execResult.error }
          : { output: execResult.result ?? null };
        let serialized = JSON.stringify(payload);
        const bytes = Buffer.byteLength(serialized, 'utf8');
        if (
          bytes > CHATBOT_TOOL_RESULT_MAX_BYTES ||
          toolResultBytes + bytes > CHATBOT_TURN_TOOL_RESULTS_MAX_BYTES
        ) {
          payload = {
            error:
              'Kết quả truy vấn quá lớn để xử lý trong lượt này. Hãy thu hẹp khoảng thời gian, bộ lọc hoặc giảm limit; không suy luận từ dữ liệu chưa được cung cấp.',
          };
          serialized = JSON.stringify(payload);
        }
        if (
          toolResultBytes + Buffer.byteLength(serialized, 'utf8') >
          CHATBOT_TURN_TOOL_RESULTS_MAX_BYTES
        ) {
          await deadline.wait(() =>
            this.assertTurnLockOwned(conversationId, lockToken),
          );
          return this.chatbotService.appendAssistantMessage(
            conversation,
            'Lượt này đã đạt giới hạn dữ liệu tra cứu. Bạn vui lòng hỏi trong phạm vi nhỏ hơn.',
          );
        }
        toolResultBytes += Buffer.byteLength(serialized, 'utf8');
        await deadline.wait(() =>
          this.assertTurnLockOwned(conversationId, lockToken),
        );
        await this.chatbotService.appendToolMessage(
          conversation,
          call.id,
          call.name,
          serialized,
        );
        responseParts.push({
          functionResponse: {
            ...(call.modelCallId ? { id: call.modelCallId } : {}),
            name: call.name,
            response: payload,
          },
        });
      }
      contents.push(createUserContent(responseParts));
    }

    await deadline.wait(() =>
      this.assertTurnLockOwned(conversationId, lockToken),
    );
    // Hit the cap without a final text answer — persist a safe fallback so
    // the turn ends with something the user can see, instead of the
    // request just hanging or throwing after burning MAX_TOOL_ITERATIONS
    // worth of Gemini calls.
    return this.chatbotService.appendAssistantMessage(
      conversation,
      'Xin lỗi, mình chưa thể hoàn tất câu trả lời trong giới hạn số bước cho phép. Bạn thử hỏi cụ thể hơn giúp mình nhé.',
    );
  }

  // Offers a tool if the caller's role is allowed for it — same gate as
  // ChatbotToolExecutorService.execute(), which still filters the data per
  // warehouse on every call.
  private toolDeclarationsFor(
    caller: ChatbotToolCaller,
  ): FunctionDeclaration[] {
    return CHATBOT_TOOLS.filter(
      (tool) =>
        (caller.role === UserRole.ADMIN ||
          tool.allowedRoles.includes(caller.role)) &&
        !CHATBOT_TOOLS_NOT_IMPLEMENTED.has(tool.name),
    ).map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Raw JSON Schema, not Google's own Schema/Type.OBJECT shape —
      // mutually exclusive with `parameters` but accepts exactly the
      // shape chatbot-tools.definitions.ts already writes.
      parametersJsonSchema: tool.input_schema,
    }));
  }

  private async assertTurnLockOwned(
    conversationId: string,
    token: string,
  ): Promise<void> {
    if ((await this.redis.get(turnLockKey(conversationId))) !== token) {
      throw new ChatbotTurnLockLostError(
        'Lượt xử lý đã mất khóa cuộc trò chuyện.',
      );
    }
  }

  private async acquireTurnLock(conversationId: string): Promise<string> {
    const token = randomUUID();
    const acquired = await this.redis.set(
      turnLockKey(conversationId),
      token,
      'EX',
      CHATBOT_TURN_LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      throw new ConflictException(
        'Trợ lý đang trả lời tin nhắn trước trong cuộc trò chuyện này, bạn vui lòng đợi.',
      );
    }
    return token;
  }

  // Deletes the lock only if it is still ours: had this turn outlived the
  // TTL, the key may now belong to the next turn. Never throws — a lock it
  // fails to release just expires on its own.
  private async releaseTurnLock(
    conversationId: string,
    token: string,
  ): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_LOCK_SCRIPT,
        1,
        turnLockKey(conversationId),
        token,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to release turn lock for conversation ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  private emitMessage(userId: string, message: Message): void {
    this.realtime.emitToUser(
      userId,
      CHATBOT_EVENTS.MESSAGE,
      plainToInstance(MessageResponseDto, message, {
        excludeExtraneousValues: true,
      }),
    );
  }

  private endTurnWithLlmFailure(
    conversation: Conversation,
    error: unknown,
  ): Promise<Message> {
    const quotaExceeded = error instanceof ApiError && error.status === 429;
    this.logger.error(
      `Gemini call failed for conversation ${conversation.id}${quotaExceeded ? ' (quota exceeded)' : ''}`,
      error instanceof Error ? error.stack : String(error),
    );
    return this.chatbotService.appendAssistantMessage(
      conversation,
      quotaExceeded ? LLM_QUOTA_MESSAGE : LLM_UNAVAILABLE_MESSAGE,
    );
  }

  private toGeminiContent(message: Message): Content {
    switch (message.role) {
      case MessageRole.USER:
        return createUserContent(message.content ?? '');

      case MessageRole.ASSISTANT:
        if (message.toolCalls && message.toolCalls.length > 0) {
          return createModelContent(
            message.toolCalls.map((call) =>
              createPartFromFunctionCall(
                call.name,
                call.arguments as Record<string, unknown>,
              ),
            ),
          );
        }
        return createModelContent(message.content ?? '');

      case MessageRole.TOOL: {
        // Stored as the JSON string built in sendMessage() above
        // ({ output } or { error }) — falls back to wrapping raw text if
        // a row ever predates that convention.
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(message.content ?? '{}') as Record<
            string,
            unknown
          >;
        } catch {
          payload = { output: message.content };
        }
        return createUserContent(
          createPartFromFunctionResponse(
            message.toolCallId ?? '',
            message.toolName ?? '',
            payload,
          ),
        );
      }

      case MessageRole.SYSTEM:
      default:
        // Never written by this module today — the system prompt goes
        // through config.systemInstruction on every call, not a stored
        // row — but handled rather than silently dropped in case that
        // changes later.
        return createUserContent(message.content ?? '');
    }
  }
}

// With finished turns reduced to their user/assistant text, two messages of
// the same role can end up adjacent — e.g. a turn whose reply was never
// stored (process crashed mid-turn) leaves user, user. Folding them into
// one content keeps the history strictly alternating.
function mergeConsecutiveRoles(contents: Content[]): Content[] {
  const merged: Content[] = [];
  for (const content of contents) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === content.role) {
      previous.parts = [...(previous.parts ?? []), ...(content.parts ?? [])];
    } else {
      merged.push({ ...content, parts: [...(content.parts ?? [])] });
    }
  }
  return merged;
}

// User-facing text of a model turn: its text parts, excluding thought
// (internal reasoning) parts. Null when there is none — e.g. a turn that
// only calls tools.
function extractText(content: Content | undefined): string | null {
  const text = (content?.parts ?? [])
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
  return text.length > 0 ? text : null;
}
