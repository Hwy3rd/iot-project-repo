import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';
import { MarkReadDto } from './dto/mark-read.dto';
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
  subscribe(@Body() createPushSubscriptionDto: CreatePushSubscriptionDto) {
    return this.notificationsService.subscribe(createPushSubscriptionDto);
  }

  @Delete('subscriptions')
  unsubscribe(@Body() unsubscribeDto: UnsubscribeDto) {
    return this.notificationsService.unsubscribe(unsubscribeDto.endpoint);
  }

  @Serialize(NotificationResponseDto)
  @Get()
  findAll(@Query() query: QueryNotificationDto) {
    return this.notificationsService.findAll(query);
  }

  @Serialize(NotificationResponseDto)
  @Post(':id/read')
  markRead(@Param('id') id: string, @Body() markReadDto: MarkReadDto) {
    return this.notificationsService.markRead(id, markReadDto.userId);
  }
}
