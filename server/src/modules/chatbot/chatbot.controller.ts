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

  // The only REST route that triggers an LLM call — see
  // ChatbotRateLimitGuard. The primary way to send is the socket event
  // `chatbot:send` (ChatbotGateway); this synchronous variant runs the same
  // turn but answers only with the final assistant reply, for REST Client
  // testing and socket-less callers. Progress/reply events are still pushed
  // to the user's sockets. The intermediate tool-call/tool-result rows are
  // available via GET :id/messages, not returned here.
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
