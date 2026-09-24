import { ApiError } from '@google/genai';
import { ConflictException } from '@nestjs/common';
import { MessageRole } from '../../libs/constants/chatbot.constant';
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
  let toolExecutor: { execute: jest.Mock };
  let realtime: { emitToUser: jest.Mock };
  let redis: { set: jest.Mock; eval: jest.Mock };
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
    toolExecutor = { execute: jest.fn().mockResolvedValue({ result: [] }) };
    realtime = { emitToUser: jest.fn() };
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    orchestrator = new ChatbotOrchestratorService(
      chatbotService as never,
      llmService as never,
      toolExecutor as never,
      { assignedRoles: jest.fn().mockResolvedValue([]) } as never,
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
});
