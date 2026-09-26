import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../../common/rbac/rbac.module';
import { LlmModule } from '../../libs/llm/llm.module';
import { AlertsModule } from '../alerts/alerts.module';
import { Alert } from '../alerts/entities/alert.entity';
import { Batch } from '../batches/entities/batch.entity';
import { ColdRoomsModule } from '../cold-rooms/cold-rooms.module';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { Command } from '../commands/entities/command.entity';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { DeviceStatusHistoryModule } from '../device-status-history/device-status-history.module';
import { Device } from '../devices/entities/device.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProductType } from '../product-types/entities/product-type.entity';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../work-shifts/entities/work-shift.entity';
import { ChatbotOrchestratorService } from './chatbot-orchestrator.service';
import { ChatbotController } from './chatbot.controller';
import { ChatbotGateway } from './chatbot.gateway';
import { ChatbotService } from './chatbot.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { ChatbotRateLimitGuard } from './guards/chatbot-rate-limit.guard';
import { ChatbotRateLimiterService } from './guards/chatbot-rate-limiter.service';
import { ChatbotToolExecutorService } from './tools/chatbot-tool-executor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      User,
      Device,
      Batch,
      ColdRoom,
      Warehouse,
      ProductType,
      Command,
      DeviceChannel,
      WorkShift,
      WarehouseStaff,
      Alert,
    ]),
    LlmModule,
    // WarehouseAccessService — same scope rules as the REST guards.
    RbacModule,
    AlertsModule,
    TelemetryModule,
    DeviceStatusHistoryModule,
    // ColdRoomStatusService — live room status for the health tools.
    ColdRoomsModule,
    // emitToUser() — replies and progress are pushed over the socket.
    RealtimeModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotRateLimiterService,
    ChatbotRateLimitGuard,
    ChatbotGateway,
    ChatbotToolExecutorService,
    ChatbotOrchestratorService,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
