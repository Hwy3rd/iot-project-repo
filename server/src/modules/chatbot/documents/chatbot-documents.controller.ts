import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Audit } from '../../../common/decorators/audit.decorator';
import { GetUserId } from '../../../common/decorators/get-user-id.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Serialize } from '../../../common/decorators/serialize.decorator';
import { UserRole } from '../../../libs/constants/user.constant';
import { ChatbotDocument } from './chatbot-document.entity';
import { documentUploadOptions } from './chatbot-document-reader';
import {
  ChatbotBuiltinDocumentDto,
  ChatbotDocumentDetailDto,
  ChatbotDocumentResponseDto,
  ChatbotDocumentsOverviewDto,
  UploadChatbotDocumentDto,
} from './chatbot-document.dto';
import { ChatbotDocumentsService } from './chatbot-documents.service';

@Roles(UserRole.ADMIN)
@Controller('chatbot/documents')
export class ChatbotDocumentsController {
  constructor(private readonly documents: ChatbotDocumentsService) {}
  @Get()
  @Serialize(ChatbotDocumentsOverviewDto)
  overview() {
    return this.documents.overview();
  }
  @Get('builtin/:filename')
  @Serialize(ChatbotBuiltinDocumentDto)
  builtin(@Param('filename') filename: string) {
    return this.documents.builtin(filename);
  }
  @Get(':id')
  @Serialize(ChatbotDocumentDetailDto)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.detail(id);
  }
  @Post()
  @Serialize(ChatbotDocumentResponseDto)
  @Audit({
    action: 'chatbot_document.upload',
    targetType: 'chatbot_document',
    entity: ChatbotDocument,
  })
  @UseInterceptors(FileInterceptor('file', documentUploadOptions))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadChatbotDocumentDto,
    @GetUserId() userId: string,
  ) {
    return this.documents.upload(file, dto.title, userId);
  }
  @Post(':id/process')
  @Serialize(ChatbotDocumentResponseDto)
  @Audit({
    action: 'chatbot_document.process',
    targetType: 'chatbot_document',
    entity: ChatbotDocument,
  })
  process(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.enqueue(id);
  }
  @Delete(':id')
  @Audit({
    action: 'chatbot_document.delete',
    targetType: 'chatbot_document',
    entity: ChatbotDocument,
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(id);
  }
}
