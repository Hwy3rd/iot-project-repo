import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../../libs/llm/llm.module';
import { AlertsModule } from '../alerts/alerts.module';
import { Batch } from '../batches/entities/batch.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { Command } from '../commands/entities/command.entity';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { DeviceStatusHistoryModule } from '../device-status-history/device-status-history.module';
import { Device } from '../devices/entities/device.entity';
import { ProductType } from '../product-types/entities/product-type.entity';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../work-shifts/entities/work-shift.entity';
import { ChatbotOrchestratorService } from './chatbot-orchestrator.service';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { ChatbotRateLimitGuard } from './guards/chatbot-rate-limit.guard';
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
    ]),
    LlmModule,
    AlertsModule,
    TelemetryModule,
    DeviceStatusHistoryModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotRateLimitGuard,
    ChatbotToolExecutorService,
    ChatbotOrchestratorService,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
