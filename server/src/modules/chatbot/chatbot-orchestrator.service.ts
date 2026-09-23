import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Content,
  createModelContent,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  createUserContent,
  FunctionDeclaration,
  Part,
} from '@google/genai';
import { LlmService } from '../../libs/llm/llm.service';
import { MessageRole } from '../../libs/constants/chatbot.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { ChatbotService } from './chatbot.service';
import { CHATBOT_SYSTEM_PROMPT } from './chatbot-system-prompt.constant';
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

// Ties ChatbotService (persistence), LlmService (Gemini) and
// ChatbotToolExecutorService (RBAC-checked tool dispatch) into the actual
// conversation loop: persist the user's turn, replay history to the model,
// and on every function-call response execute the tool, persist both the
// call and its result, and feed the result back — repeating until the
// model answers in plain text or MAX_TOOL_ITERATIONS is hit.
@Injectable()
export class ChatbotOrchestratorService {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly llmService: LlmService,
    private readonly toolExecutor: ChatbotToolExecutorService,
  ) {}

  async sendMessage(
    conversationId: string,
    caller: ChatbotToolCaller,
    content: string,
  ): Promise<Message> {
    const conversation = await this.chatbotService.findConversation(
      conversationId,
      caller.id,
    );
    await this.chatbotService.addUserMessage(conversationId, caller.id, {
      content,
    });

    const history = await this.chatbotService.findMessages(
      conversationId,
      caller.id,
      {},
    );
    const contents: Content[] = history.map((message) =>
      this.toGeminiContent(message),
    );
    const toolDeclarations = this.toolDeclarationsForRole(caller.role);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await this.llmService.generateContent({
        contents,
        config: {
          systemInstruction: CHATBOT_SYSTEM_PROMPT,
          tools:
            toolDeclarations.length > 0
              ? [{ functionDeclarations: toolDeclarations }]
              : undefined,
        },
      });

      const functionCalls = response.functionCalls ?? [];
      if (functionCalls.length === 0) {
        return this.chatbotService.appendAssistantMessage(
          conversation,
          response.text ?? '',
        );
      }

      const toolCalls = functionCalls.map((call) => ({
        id: call.id ?? randomUUID(),
        name: call.name ?? '',
        arguments: call.args ?? {},
      }));
      await this.chatbotService.appendAssistantMessage(
        conversation,
        response.text ?? null,
        toolCalls,
      );
      contents.push(
        createModelContent(
          toolCalls.map((call) =>
            createPartFromFunctionCall(call.name, call.arguments),
          ),
        ),
      );

      const responseParts: Part[] = [];
      for (const call of toolCalls) {
        const execResult = await this.toolExecutor.execute(
          call.name,
          call.arguments,
          caller,
        );
        const payload = execResult.error
          ? { error: execResult.error }
          : { output: execResult.result ?? null };
        await this.chatbotService.appendToolMessage(
          conversation,
          call.id,
          call.name,
          JSON.stringify(payload),
        );
        responseParts.push(
          createPartFromFunctionResponse(call.id, call.name, payload),
        );
      }
      contents.push(createUserContent(responseParts));
    }

    // Hit the cap without a final text answer — persist a safe fallback so
    // the turn ends with something the user can see, instead of the
    // request just hanging or throwing after burning MAX_TOOL_ITERATIONS
    // worth of Gemini calls.
    return this.chatbotService.appendAssistantMessage(
      conversation,
      'Xin lỗi, mình chưa thể hoàn tất câu trả lời trong giới hạn số bước cho phép. Bạn thử hỏi cụ thể hơn giúp mình nhé.',
    );
  }

  private toolDeclarationsForRole(role: UserRole): FunctionDeclaration[] {
    return CHATBOT_TOOLS.filter(
      (tool) =>
        tool.allowedRoles.includes(role) &&
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
