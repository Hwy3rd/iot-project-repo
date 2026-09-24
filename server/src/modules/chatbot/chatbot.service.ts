import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { MessageRole } from '../../libs/constants/chatbot.constant';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { QueryMessageDto } from './dto/query-message.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

const DEFAULT_MESSAGE_LIMIT = 50;
const TITLE_PREVIEW_LENGTH = 80;

type AppendMessageFields = {
  role: MessageRole;
  content: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }> | null;
  toolCallId?: string | null;
  toolName?: string | null;
};

@Injectable()
export class ChatbotService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messagesRepository: Repository<Message>,
  ) {}

  createConversation(
    userId: string,
    dto: CreateConversationDto,
  ): Promise<Conversation> {
    const conversation = this.conversationsRepository.create({
      userId,
      title: dto.title ?? null,
    });
    return this.conversationsRepository.save(conversation);
  }

  async findConversations(
    userId: string,
    query: PaginationQueryDto = {},
  ): Promise<Paginated<Conversation>> {
    const pagination = resolvePagination(query);
    const [items, total] = await this.conversationsRepository.findAndCount({
      where: { userId },
      order: { lastMessageAt: 'DESC', createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  // Same "same 404 whether missing or someone else's" pattern as
  // NotificationsService.markRead — never confirms another user's
  // conversation ids exist.
  async findConversation(id: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversationsRepository.findOne({
      where: { id, userId },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  async removeConversation(id: string, userId: string): Promise<void> {
    const result = await this.conversationsRepository.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
  }

  // The latest `limit` messages (or the page before `query.before`), in
  // chronological order — newest-first query, then reversed. Ordering by
  // ASC with a limit would return the *oldest* page and never the newest.
  async findMessages(
    conversationId: string,
    userId: string,
    query: QueryMessageDto,
  ): Promise<Message[]> {
    await this.findConversation(conversationId, userId);

    let createdBefore: Date | undefined;
    if (query.before) {
      const cursor = await this.messagesRepository.findOne({
        where: { id: query.before, conversationId },
      });
      if (!cursor) {
        throw new NotFoundException(`Message ${query.before} not found`);
      }
      createdBefore = cursor.createdAt;
    }

    const rows = await this.messagesRepository.find({
      where: {
        conversationId,
        ...(createdBefore ? { createdAt: LessThan(createdBefore) } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: query.limit ?? DEFAULT_MESSAGE_LIMIT,
    });
    return rows.reverse();
  }

  // What gets replayed to the LLM for a new turn: the most recent `limit`
  // *conversational* messages — user messages and the assistant's text
  // replies — in chronological order, starting at a USER message.
  //
  // Tool-call rows and tool results of earlier, finished turns are left out
  // on purpose: they were only needed to produce that turn's answer, which
  // is itself kept, while replaying them would resend every past tool
  // output (often large JSON lists) on every later request — the main
  // driver of Gemini token-per-minute rate limits. The turn in progress
  // still sees its own tool results; the orchestrator keeps those in
  // memory for the length of the tool loop. They also stay stored, so
  // GET :id/messages still shows them.
  //
  // Caller must already have checked the conversation's ownership.
  async findRecentHistory(
    conversationId: string,
    limit: number,
  ): Promise<Message[]> {
    const rows = await this.messagesRepository.find({
      where: {
        conversationId,
        role: In([MessageRole.USER, MessageRole.ASSISTANT]),
        toolCalls: IsNull(),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    rows.reverse();
    const firstUserTurn = rows.findIndex(
      (message) => message.role === MessageRole.USER,
    );
    return firstUserTurn === -1 ? [] : rows.slice(firstUserTurn);
  }

  // The only write path reachable over HTTP — always writes role=USER, so a
  // client can never forge an ASSISTANT/TOOL row (those are appended by the
  // future LLM-orchestration service via appendAssistantMessage/
  // appendToolMessage below, not through this controller).
  async addUserMessage(
    conversationId: string,
    userId: string,
    dto: CreateMessageDto,
  ): Promise<Message> {
    const conversation = await this.findConversation(conversationId, userId);
    const message = await this.appendMessage(conversation, {
      role: MessageRole.USER,
      content: dto.content,
    });
    if (!conversation.title) {
      await this.conversationsRepository.update(conversation.id, {
        title: dto.content.slice(0, TITLE_PREVIEW_LENGTH),
      });
    }
    return message;
  }

  // Not exposed over HTTP — called by the LLM-orchestration service once it
  // has a completion back, mirroring NotificationsService.notifyNewAlert's
  // internal-only pattern.
  appendAssistantMessage(
    conversation: Conversation,
    content: string | null,
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: unknown;
    }> | null = null,
  ): Promise<Message> {
    return this.appendMessage(conversation, {
      role: MessageRole.ASSISTANT,
      content,
      toolCalls,
    });
  }

  // Not exposed over HTTP — called by the LLM-orchestration service after it
  // executes a tool server-side, to persist the (already scoped/redacted)
  // result before replaying it back to the LLM on the next turn.
  appendToolMessage(
    conversation: Conversation,
    toolCallId: string,
    toolName: string,
    content: string,
  ): Promise<Message> {
    return this.appendMessage(conversation, {
      role: MessageRole.TOOL,
      content,
      toolCallId,
      toolName,
    });
  }

  private async appendMessage(
    conversation: Conversation,
    fields: AppendMessageFields,
  ): Promise<Message> {
    const message = this.messagesRepository.create({
      conversationId: conversation.id,
      role: fields.role,
      content: fields.content,
      toolCalls: fields.toolCalls ?? null,
      toolCallId: fields.toolCallId ?? null,
      toolName: fields.toolName ?? null,
    });
    const saved = await this.messagesRepository.save(message);
    await this.conversationsRepository.update(conversation.id, {
      lastMessageAt: saved.createdAt,
    });
    return saved;
  }
}
