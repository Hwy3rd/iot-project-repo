import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import { GetUserRole } from '../../common/decorators/get-user-role.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { ChatbotOrchestratorService } from './chatbot-orchestrator.service';
import { ChatbotService } from './chatbot.service';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { QueryMessageDto } from './dto/query-message.dto';
import { ChatbotRateLimitGuard } from './guards/chatbot-rate-limit.guard';

// No @Roles() here, same as NotificationsController — any authenticated
// user manages their own conversations, scoped purely by userId (not by
// warehouse), so WarehouseScopeGuard doesn't apply either.
@Controller('chatbot/conversations')
export class ChatbotController {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly orchestrator: ChatbotOrchestratorService,
  ) {}

  @Serialize(ConversationResponseDto)
  @Post()
  create(@GetUserId() userId: string, @Body() dto: CreateConversationDto) {
    return this.chatbotService.createConversation(userId, dto);
  }

  @Serialize(ConversationResponseDto)
  @Get()
  findAll(@GetUserId() userId: string) {
    return this.chatbotService.findConversations(userId);
  }

  @Serialize(ConversationResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string, @GetUserId() userId: string) {
    return this.chatbotService.findConversation(id, userId);
  }

  // Returns default 200 with data: null, not 204 — see CLAUDE.md's API
  // response convention (TransformInterceptor always writes a JSON body).
  @Delete(':id')
  remove(@Param('id') id: string, @GetUserId() userId: string) {
    return this.chatbotService.removeConversation(id, userId);
  }

  @Serialize(MessageResponseDto)
  @Get(':id/messages')
  findMessages(
    @Param('id') id: string,
    @GetUserId() userId: string,
    @Query() query: QueryMessageDto,
  ) {
    return this.chatbotService.findMessages(id, userId, query);
  }

  // The only route that triggers an LLM call — see ChatbotRateLimitGuard
  // for why this is the one route that needs it. Persists the user's
  // message, runs the full tool-calling loop, and returns the final
  // assistant reply (the client already has its own message locally; the
  // intermediate tool-call/tool-result rows this turn also wrote are
  // available via GET :id/messages if needed, not returned here).
  @UseGuards(ChatbotRateLimitGuard)
  @Serialize(MessageResponseDto)
  @Post(':id/messages')
  addMessage(
    @Param('id') id: string,
    @GetUserId() userId: string,
    @GetUserRole() role: UserRole,
    @Body() dto: CreateMessageDto,
  ) {
    return this.orchestrator.sendMessage(id, { id: userId, role }, dto.content);
  }
}
