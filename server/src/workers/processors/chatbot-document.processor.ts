import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import {
  ChatbotDocumentsService,
  type DocumentJob,
} from '../../modules/chatbot/documents/chatbot-documents.service';

@Processor(QUEUE_NAMES.CHATBOT_DOCUMENTS, { concurrency: 1 })
export class ChatbotDocumentProcessor extends WorkerHost {
  constructor(private readonly documents: ChatbotDocumentsService) {
    super();
  }
  async process(job: Job<DocumentJob>): Promise<void> {
    await this.documents.process(job.data);
  }
}
