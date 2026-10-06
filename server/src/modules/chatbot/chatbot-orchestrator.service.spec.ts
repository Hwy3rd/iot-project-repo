import { ApiError } from '@google/genai';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  CHATBOT_TURN_TIMEOUT_MS,
  CHATBOT_TOOL_RESULT_MAX_BYTES,
  CHATBOT_TURN_TOOL_RESULTS_MAX_BYTES,
  MessageRole,
} from '../../libs/constants/chatbot.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { ChatbotOrchestratorService } from './chatbot-orchestrator.service';

// Shape of a real Gemini response: text lives in candidates[0].content.
const textResponse = (text: string) => ({
  text,
  candidates: [{ content: { role: 'model', parts: [{ text }] } }],
});

describe('ChatbotOrchestratorService', () => {
  const conversation = { id: 'c1', userId: 'u1' };
  const caller = { id: 'u1', role: UserRole.MANAGER };
  let chatbotService: {
    findConversation: jest.Mock;
    addUserMessage: jest.Mock;
    findRecentHistory: jest.Mock;
    appendAssistantMessage: jest.Mock;
    appendToolMessage: jest.Mock;
  };
  let llmService: { generateContent: jest.Mock };
  let toolExecutor: { execute: jest.Mock; resolveWorkingWarehouse: jest.Mock };
  let realtime: { emitToUser: jest.Mock };
  let redis: { set: jest.Mock; get: jest.Mock; eval: jest.Mock };
  let orchestrator: ChatbotOrchestratorService;

  beforeEach(() => {
    chatbotService = {
      findConversation: jest.fn().mockResolvedValue(conversation),
      addUserMessage: jest.fn().mockResolvedValue({
        id: 'm-user',
        conversationId: 'c1',
        role: MessageRole.USER,
        content: 'Xin chào',
      }),
      findRecentHistory: jest
        .fn()
        .mockResolvedValue([{ role: MessageRole.USER, content: 'Xin chào' }]),
      appendAssistantMessage: jest.fn((_c: unknown, content: string) =>
        Promise.resolve({ role: MessageRole.ASSISTANT, content }),
      ),
      appendToolMessage: jest.fn(),
    };
    llmService = { generateContent: jest.fn() };
    toolExecutor = {
      execute: jest.fn().mockResolvedValue({ result: [] }),
      resolveWorkingWarehouse: jest.fn().mockResolvedValue({
        id: 'w3',
        code: 'WH-HN-03',
        name: 'Kho lạnh Bắc Thăng Long',
      }),
    };
    realtime = { emitToUser: jest.fn() };
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(() =>
        Promise.resolve((redis.set.mock.calls as unknown[][]).at(-1)?.[1]),
      ),
      eval: jest.fn().mockResolvedValue(1),
    };
    orchestrator = new ChatbotOrchestratorService(
      chatbotService as never,
      llmService as never,
      toolExecutor as never,
      realtime as never,
      redis as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('replays only the recent history window to the model', async () => {
    llmService.generateContent.mockResolvedValue(textResponse('Chào bạn'));

    await orchestrator.sendMessage('c1', caller, 'Xin chào');

    expect(chatbotService.findRecentHistory).toHaveBeenCalledWith('c1', 40);
  });

  it('still feeds the current turn its own tool results', async () => {
    llmService.generateContent
      .mockResolvedValueOnce({
        functionCalls: [{ id: 'call1', name: 'get_alerts', args: {} }],
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { functionCall: { id: 'call1', name: 'get_alerts', args: {} } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(textResponse('Không có cảnh báo nào.'));
    toolExecutor.execute.mockResolvedValue({ result: [{ id: 'a1' }] });

    await orchestrator.sendMessage('c1', caller, 'Có cảnh báo gì?');

    const [secondCall] = llmService.generateContent.mock.calls[1] as [
      { contents: { role: string; parts: { functionResponse?: unknown }[] }[] },
    ];
    const last = secondCall.contents[secondCall.contents.length - 1];
    expect(last.parts[0].functionResponse).toMatchObject({
      name: 'get_alerts',
      response: { output: [{ id: 'a1' }] },
    });
    // Stored for the record, but never read back for later turns.
    expect(chatbotService.appendToolMessage).toHaveBeenCalledTimes(1);
  });

  it("replays the model's function-call turn verbatim, thought signature included", async () => {
    const modelTurn = {
      role: 'model',
      parts: [
        { text: 'đang suy nghĩ…', thought: true },
        {
          functionCall: { name: 'get_alerts', args: {} },
          thoughtSignature: 'sig-abc',
        },
      ],
    };
    llmService.generateContent
      .mockResolvedValueOnce({
        functionCalls: [{ name: 'get_alerts', args: {} }],
        candidates: [{ content: modelTurn }],
      })
      .mockResolvedValueOnce(textResponse('Không có cảnh báo nào.'));

    const reply = await orchestrator.sendMessage(
      'c1',
      caller,
      'Có cảnh báo gì?',
    );

    const [secondCall] = llmService.generateContent.mock.calls[1] as [
      { contents: { role: string; parts: Record<string, unknown>[] }[] },
    ];
    const replayed = secondCall.contents[secondCall.contents.length - 2];
    expect(replayed).toBe(modelTurn);
    expect(replayed.parts[1].thoughtSignature).toBe('sig-abc');
    // Gemini gave no call id, so none is invented on the response part.
    const responsePart = secondCall.contents[secondCall.contents.length - 1]
      .parts[0] as { functionResponse: Record<string, unknown> };
    expect(responsePart.functionResponse).not.toHaveProperty('id');
    // The thought part never leaks into what the user sees or is stored.
    expect(chatbotService.appendAssistantMessage).toHaveBeenNthCalledWith(
      1,
      conversation,
      null,
      [expect.objectContaining({ name: 'get_alerts' })],
    );
    expect(reply.content).toBe('Không có cảnh báo nào.');
  });

  it('folds adjacent same-role history messages into one turn', async () => {
    chatbotService.findRecentHistory.mockResolvedValue([
      { role: MessageRole.USER, content: 'Câu hỏi cũ chưa có trả lời' },
      { role: MessageRole.USER, content: 'Câu hỏi mới' },
    ]);
    llmService.generateContent.mockResolvedValue(textResponse('ok'));

    await orchestrator.sendMessage('c1', caller, 'Câu hỏi mới');

    const [params] = llmService.generateContent.mock.calls[0] as [
      { contents: { role: string; parts: unknown[] }[] },
    ];
    expect(params.contents).toHaveLength(1);
    expect(params.contents[0].role).toBe('user');
    expect(params.contents[0].parts).toHaveLength(2);
  });

  it("tells the model today's date in Vietnam time", async () => {
    jest.useFakeTimers({ now: new Date('2026-09-24T18:30:00Z') }); // 01:30 on the 25th in UTC+7
    llmService.generateContent.mockResolvedValue(textResponse('ok'));

    await orchestrator.sendMessage('c1', caller, 'Hôm nay có cảnh báo gì?');

    const [params] = llmService.generateContent.mock.calls[0] as [
      { config: { systemInstruction: string } },
    ];
    expect(params.config.systemInstruction).toContain('ngày 2026-09-25');
    expect(params.config.systemInstruction).toContain('+07:00');
  });

  describe("the header's warehouse", () => {
    it('makes it the default for answers and tool calls', async () => {
      llmService.generateContent
        .mockResolvedValueOnce({
          functionCalls: [
            { id: 'call1', name: 'get_cold_room_detail', args: {} },
          ],
        })
        .mockResolvedValueOnce(textResponse('ok'));

      await orchestrator.sendMessage('c1', caller, 'Phòng A1 thế nào?', 'w3');

      expect(toolExecutor.resolveWorkingWarehouse).toHaveBeenCalledWith(
        caller,
        'w3',
      );
      const [params] = llmService.generateContent.mock.calls[0] as [
        { config: { systemInstruction: string } },
      ];
      expect(params.config.systemInstruction).toContain(
        'Kho đang làm việc: Kho lạnh Bắc Thăng Long (mã WH-HN-03)',
      );
      expect(toolExecutor.execute).toHaveBeenCalledWith(
        'get_cold_room_detail',
        {},
        { ...caller, workingWarehouseId: 'w3' },
      );
    });

    it('falls back to all warehouses without one', async () => {
      llmService.generateContent.mockResolvedValue(textResponse('ok'));

      await orchestrator.sendMessage('c1', caller, 'Tình hình thế nào?');

      expect(toolExecutor.resolveWorkingWarehouse).not.toHaveBeenCalled();
      const [params] = llmService.generateContent.mock.calls[0] as [
        { config: { systemInstruction: string } },
      ];
      expect(params.config.systemInstruction).toContain('TẤT CẢ các kho');
    });

    it('stores nothing for a warehouse the caller is not assigned to', async () => {
      toolExecutor.resolveWorkingWarehouse.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        orchestrator.sendMessage('c1', caller, 'Xin chào', 'w9'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(chatbotService.addUserMessage).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  it('ends the turn with a quota message when Gemini returns 429', async () => {
    llmService.generateContent.mockRejectedValue(
      new ApiError({ message: 'RESOURCE_EXHAUSTED', status: 429 }),
    );

    const reply = await orchestrator.sendMessage('c1', caller, 'Xin chào');

    expect(reply.content).toContain('hạn mức');
    expect(chatbotService.appendAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it('ends the turn with a generic message on any other failure', async () => {
    llmService.generateContent.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      orchestrator.sendMessage('c1', caller, 'Xin chào'),
    ).resolves.toMatchObject({
      content: expect.stringContaining('tạm thời không phản hồi') as string,
    });
  });

  describe('turns and socket events', () => {
    const emitted = () =>
      realtime.emitToUser.mock.calls.map(
        ([userId, event]: [string, string]) => `${userId}:${event}`,
      );

    it('pushes the user message, tool progress and the reply to the user room', async () => {
      llmService.generateContent
        .mockResolvedValueOnce({
          functionCalls: [{ name: 'get_alerts', args: {} }],
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ functionCall: { name: 'get_alerts', args: {} } }],
              },
            },
          ],
        })
        .mockResolvedValueOnce(textResponse('Không có cảnh báo nào.'));

      await orchestrator.sendMessage('c1', caller, 'Có cảnh báo gì?');

      expect(emitted()).toEqual([
        'u1:chatbot:message',
        'u1:chatbot:tool_call',
        'u1:chatbot:message',
      ]);
      expect(realtime.emitToUser).toHaveBeenNthCalledWith(
        2,
        'u1',
        'chatbot:tool_call',
        { conversationId: 'c1', tools: ['get_alerts'] },
      );
      const [, , reply] = realtime.emitToUser.mock.calls[2] as [
        string,
        string,
        { content: string },
      ];
      expect(reply.content).toBe('Không có cảnh báo nào.');
    });

    it('answers startTurn before the model does', async () => {
      let answer!: (value: unknown) => void;
      llmService.generateContent.mockReturnValue(
        new Promise((resolve) => (answer = resolve)),
      );

      const turn = await orchestrator.startTurn('c1', caller, 'Xin chào');

      expect(turn.userMessage.id).toBe('m-user');
      expect(emitted()).toEqual(['u1:chatbot:message']);
      answer(textResponse('Chào bạn'));
      await expect(turn.completion).resolves.toMatchObject({
        content: 'Chào bạn',
      });
    });

    it('refuses a second turn while one is running, storing nothing', async () => {
      redis.set.mockResolvedValue(null);

      await expect(
        orchestrator.startTurn('c1', caller, 'Xin chào'),
      ).rejects.toThrow(ConflictException);
      expect(chatbotService.addUserMessage).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'chatbot:turn:c1',
        expect.any(String),
        'EX',
        180,
        'NX',
      );
    });

    it('releases its own lock when the turn ends', async () => {
      llmService.generateContent.mockResolvedValue(textResponse('ok'));

      await orchestrator.sendMessage('c1', caller, 'Xin chào');

      const [, token] = redis.set.mock.calls[0] as [string, string];
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('DEL'"),
        1,
        'chatbot:turn:c1',
        token,
      );
    });

    it('emits an error event and releases the lock on an unexpected failure', async () => {
      llmService.generateContent.mockResolvedValue(textResponse('ok'));
      chatbotService.appendAssistantMessage.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        orchestrator.sendMessage('c1', caller, 'Xin chào'),
      ).rejects.toThrow('db down');
      expect(emitted()).toContain('u1:chatbot:error');
      expect(redis.eval).toHaveBeenCalledTimes(1);
    });
  });
  describe('empty replies', () => {
    it.each([
      {},
      textResponse('   '),
      { candidates: [{ finishReason: 'SAFETY' }] },
    ])(
      'stores and emits a visible fallback instead of an empty final message',
      async (response) => {
        llmService.generateContent.mockResolvedValue(response);
        const reply = await orchestrator.sendMessage('c1', caller, 'Question');
        expect(reply.content?.trim()).toBeTruthy();
        expect(reply.content).toContain('chưa nhận được');
        expect(chatbotService.appendAssistantMessage).toHaveBeenCalledTimes(1);
        const last = (realtime.emitToUser.mock.calls as unknown[][]).at(
          -1,
        )?.[2] as {
          content: string;
        };
        expect(last.content.trim()).toBeTruthy();
      },
    );
  });

  describe('turn deadlines', () => {
    it('aborts a stalled model, ends the turn before lease expiry and ignores its late reply', async () => {
      jest.useFakeTimers();
      let resolveOld!: (value: unknown) => void;
      llmService.generateContent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      );
      const turn = await orchestrator.startTurn('c1', caller, 'Old question');
      await jest.advanceTimersByTimeAsync(CHATBOT_TURN_TIMEOUT_MS);
      const reply = await turn.completion;
      expect(reply.content).toContain('quá nhiều thời gian');
      const [params] = llmService.generateContent.mock.calls[0] as [
        { config: { abortSignal: AbortSignal } },
      ];
      expect(params.config.abortSignal.aborted).toBe(true);
      expect(redis.eval).toHaveBeenCalledTimes(1);
      llmService.generateContent.mockResolvedValueOnce(
        textResponse('New reply'),
      );
      await orchestrator.sendMessage('c1', caller, 'New question');
      resolveOld(textResponse('Late old reply'));
      await jest.advanceTimersByTimeAsync(0);
      expect(
        (chatbotService.appendAssistantMessage.mock.calls as unknown[][]).map(
          (call) => call[1],
        ),
      ).toEqual([reply.content, 'New reply']);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('ignores a tool result arriving after the shared deadline', async () => {
      jest.useFakeTimers();
      let resolveTool!: (value: unknown) => void;
      llmService.generateContent.mockResolvedValueOnce({
        functionCalls: [{ name: 'get_alerts', args: {} }],
      });
      toolExecutor.execute.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTool = resolve;
          }),
      );
      const turn = await orchestrator.startTurn('c1', caller, 'Question');
      await jest.advanceTimersByTimeAsync(CHATBOT_TURN_TIMEOUT_MS);
      expect((await turn.completion).content).toContain('quá nhiều thời gian');
      resolveTool({ result: ['late data'] });
      await jest.advanceTimersByTimeAsync(0);
      expect(chatbotService.appendToolMessage).not.toHaveBeenCalled();
      expect(llmService.generateContent).toHaveBeenCalledTimes(1);
    });

    it('shares one deadline across multiple model calls', async () => {
      jest.useFakeTimers();
      llmService.generateContent
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    functionCalls: [{ name: 'get_alerts', args: {} }],
                  }),
                80_000,
              ),
            ),
        )
        .mockImplementationOnce(() => new Promise(() => {}));
      const turn = await orchestrator.startTurn('c1', caller, 'Question');
      await jest.advanceTimersByTimeAsync(80_000);
      expect(llmService.generateContent).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(CHATBOT_TURN_TIMEOUT_MS - 80_000);
      expect((await turn.completion).content).toContain('quá nhiều thời gian');
    });

    it('does not append a reply when its lease belongs to another turn', async () => {
      llmService.generateContent.mockResolvedValue(textResponse('Stale reply'));
      redis.get.mockResolvedValue('another-token');
      await expect(
        orchestrator.sendMessage('c1', caller, 'Question'),
      ).rejects.toThrow(ConflictException);
      expect(chatbotService.appendAssistantMessage).not.toHaveBeenCalled();
      expect(
        (realtime.emitToUser.mock.calls as unknown[][]).map((call) => call[1]),
      ).toEqual(['chatbot:message']);
    });

    it('does not write a timeout fallback after losing the lease', async () => {
      jest.useFakeTimers();
      llmService.generateContent.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      const turn = await orchestrator.startTurn('c1', caller, 'Question');
      const rejected = expect(turn.completion).rejects.toThrow(
        ConflictException,
      );
      redis.get.mockResolvedValue(null);
      await jest.advanceTimersByTimeAsync(CHATBOT_TURN_TIMEOUT_MS);
      await rejected;
      expect(chatbotService.appendAssistantMessage).not.toHaveBeenCalled();
      expect(
        (realtime.emitToUser.mock.calls as unknown[][]).map((call) => call[1]),
      ).toEqual(['chatbot:message']);
    });
  });

  describe('tool result budgets', () => {
    it('replaces an oversized Unicode result with a valid error payload before storage and replay', async () => {
      llmService.generateContent
        .mockResolvedValueOnce({
          functionCalls: [{ name: 'get_alerts', args: {} }],
        })
        .mockResolvedValueOnce(textResponse('Please narrow the range'));
      toolExecutor.execute.mockResolvedValue({
        result: 'đ'.repeat(CHATBOT_TOOL_RESULT_MAX_BYTES),
      });
      await orchestrator.sendMessage('c1', caller, 'Question');
      const serialized = (
        chatbotService.appendToolMessage.mock.calls as unknown[][]
      )[0][3] as string;
      expect(JSON.parse(serialized) as unknown).toEqual({
        error: expect.stringContaining('quá lớn') as unknown,
      });
      expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(
        CHATBOT_TOOL_RESULT_MAX_BYTES,
      );
      const [params] = llmService.generateContent.mock.calls[1] as [
        {
          contents: { parts: { functionResponse?: { response: unknown } }[] }[];
        },
      ];
      expect(
        params.contents.at(-1)?.parts[0].functionResponse?.response,
      ).toEqual(JSON.parse(serialized) as unknown);
    });

    it('counts tool payloads across iterations, not just within each call', async () => {
      const response = { functionCalls: [{ name: 'get_alerts', args: {} }] };
      llmService.generateContent
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(textResponse('Reply'));
      toolExecutor.execute.mockResolvedValue({ result: 'x'.repeat(25_000) });
      await orchestrator.sendMessage('c1', caller, 'Question');
      const payloads = (
        chatbotService.appendToolMessage.mock.calls as unknown[][]
      ).map((call) => call[3] as string);
      expect(payloads.map((p) => JSON.parse(p) as unknown)).toEqual([
        { output: 'x'.repeat(25_000) },
        { output: 'x'.repeat(25_000) },
        { error: expect.stringContaining('quá lớn') as unknown },
      ]);
      expect(
        payloads.reduce((sum, p) => sum + Buffer.byteLength(p), 0),
      ).toBeLessThanOrEqual(CHATBOT_TURN_TOOL_RESULTS_MAX_BYTES);
    });
  });
});
