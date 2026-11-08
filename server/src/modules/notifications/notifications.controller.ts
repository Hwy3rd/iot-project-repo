import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import { GetUserRole } from '../../common/decorators/get-user-role.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { Public } from '../../common/decorators/public.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { PushSubscriptionResponseDto } from './dto/push-subscription-response.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // For the frontend's `pushManager.subscribe({ applicationServerKey })`.
  // Not @Serialize'd: a plain value, not an entity.
  @Public()
  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { publicKey: this.config.get<string>('VAPID_PUBLIC_KEY') ?? null };
  }

  @Serialize(PushSubscriptionResponseDto)
  @Post('subscriptions')
  subscribe(
    @GetUserId() userId: string,
    @Body() createPushSubscriptionDto: CreatePushSubscriptionDto,
  ) {
    return this.notificationsService.subscribe(
      userId,
      createPushSubscriptionDto,
    );
  }

  @Delete('subscriptions')
  unsubscribe(
    @GetUserId() userId: string,
    @Body() unsubscribeDto: UnsubscribeDto,
  ) {
    return this.notificationsService.unsubscribe(
      userId,
      unsubscribeDto.endpoint,
    );
  }

  @Serialize(NotificationResponseDto)
  @Get()
  findAll(
    @GetUserId() userId: string,
    @GetUserRole() role: UserRole,
    @Query() query: QueryNotificationDto,
  ) {
    return this.notificationsService.findAll(userId, query, role);
  }

  // Marks what GET /notifications would show as read (Staff: only the
  // warehouses they're on shift at).
  @HttpCode(HttpStatus.OK)
  @Post('read-all')
  markAllRead(@GetUserId() userId: string, @GetUserRole() role: UserRole) {
    return this.notificationsService.markAllRead(userId, role);
  }

  @Serialize(NotificationResponseDto)
  @Post(':id/read')
  markRead(@Param('id') id: string, @GetUserId() userId: string) {
    return this.notificationsService.markRead(id, userId);
  }
}
