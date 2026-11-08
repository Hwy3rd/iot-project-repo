import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../../../libs/llm/llm.module';
import { QUEUE_NAMES } from '../../../libs/constants/queue.constant';
import { ChatbotDocument } from './chatbot-document.entity';
import { ChatbotDocumentReader } from './chatbot-document-reader';
import { ChatbotDocumentsService } from './chatbot-documents.service';
import { ChatbotEmbeddingService } from './chatbot-embedding.service';

// Shared by the HTTP application and worker; HTTP controller is registered only in ChatbotModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotDocument]),
    BullModule.registerQueue({ name: QUEUE_NAMES.CHATBOT_DOCUMENTS }),
    LlmModule,
  ],
  providers: [
    ChatbotDocumentReader,
    ChatbotDocumentsService,
    ChatbotEmbeddingService,
  ],
  exports: [ChatbotDocumentsService, ChatbotEmbeddingService],
})
export class ChatbotDocumentsModule {}
