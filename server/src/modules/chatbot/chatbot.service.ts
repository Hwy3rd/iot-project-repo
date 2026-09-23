import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  findConversations(userId: string): Promise<Conversation[]> {
    return this.conversationsRepository.find({
      where: { userId },
      order: { lastMessageAt: 'DESC', createdAt: 'DESC' },
    });
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

  async findMessages(
    conversationId: string,
    userId: string,
    query: QueryMessageDto,
  ): Promise<Message[]> {
    await this.findConversation(conversationId, userId);
    return this.messagesRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: query.limit ?? DEFAULT_MESSAGE_LIMIT,
    });
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
