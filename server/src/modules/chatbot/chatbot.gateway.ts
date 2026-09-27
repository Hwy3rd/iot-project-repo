import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CHATBOT_EVENTS } from '../../libs/constants/chatbot.constant';
import type { AppSocket } from '../realtime/realtime.types';
import { REALTIME_GATEWAY_OPTIONS } from '../realtime/realtime.util';
import { ChatbotOrchestratorService } from './chatbot-orchestrator.service';
import { MessageResponseDto } from './dto/message-response.dto';
import { SendChatbotMessageDto } from './dto/send-chatbot-message.dto';
import { ChatbotRateLimiterService } from './guards/chatbot-rate-limiter.service';

export type ChatbotSendAck =
  | { ok: true; message: MessageResponseDto }
  | { ok: false; error: { statusCode: number; message: string | string[] } };

// Socket entry point for chatting — shares RealtimeGateway's socket.io
// server, whose handshake middleware has already authenticated every
// socket (client.data.user) before any event reaches this handler.
//
// `chatbot:send` answers through the socket.io ack as soon as the user's
// message is stored — it does not wait for the model. Progress and the
// reply then arrive as CHATBOT_EVENTS pushed to the user's room. Every
// failure is returned in the ack ({ ok: false, error }) rather than thrown:
// a thrown exception would go to the generic `exception` event instead,
// leaving the client's ack callback hanging.
@WebSocketGateway(REALTIME_GATEWAY_OPTIONS)
export class ChatbotGateway {
  private readonly logger = new Logger(ChatbotGateway.name);

  constructor(
    private readonly orchestrator: ChatbotOrchestratorService,
    private readonly rateLimiter: ChatbotRateLimiterService,
  ) {}

  @SubscribeMessage(CHATBOT_EVENTS.SEND)
  async handleSend(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<ChatbotSendAck> {
    try {
      const user = client.data.user;
      if (!user) throw new UnauthorizedException('Not authenticated');
      // REST rejects an expired access token on every request; a socket
      // stays open past it, so check here before spending an LLM call. The
      // client refreshes (POST /auth/refresh) and reconnects.
      if (Date.now() >= user.tokenExpiresAt) {
        throw new UnauthorizedException(
          'Phiên đăng nhập đã hết hạn, vui lòng kết nối lại.',
        );
      }

      const dto = await validateSendPayload(body);
      await this.rateLimiter.consume(user.id);
      const turn = await this.orchestrator.startTurn(
        dto.conversationId,
        { id: user.id, role: user.role },
        dto.content,
        dto.warehouseId,
      );
      // The orchestrator already logged it and emitted CHATBOT_EVENTS.ERROR.
      turn.completion.catch(() => undefined);

      return {
        ok: true,
        message: plainToInstance(MessageResponseDto, turn.userMessage, {
          excludeExtraneousValues: true,
        }),
      };
    } catch (error) {
      return { ok: false, error: this.toAckError(error) };
    }
  }

  private toAckError(error: unknown): {
    statusCode: number;
    message: string | string[];
  } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'object' && 'message' in response
          ? (response.message as string | string[])
          : error.message;
      return { statusCode: error.getStatus(), message };
    }
    this.logger.error(
      'chatbot:send failed',
      error instanceof Error ? error.stack : String(error),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}

// Same rules the global ValidationPipe applies to REST bodies (whitelist:
// unknown fields are dropped), done by hand: a pipe's BadRequestException
// would surface as the generic `exception` event, not in the ack.
async function validateSendPayload(
  body: unknown,
): Promise<SendChatbotMessageDto> {
  const dto = plainToInstance(
    SendChatbotMessageDto,
    typeof body === 'object' && body !== null ? body : {},
  );
  const errors = await validate(dto, { whitelist: true });
  if (errors.length > 0) {
    throw new BadRequestException(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    );
  }
  return dto;
}
