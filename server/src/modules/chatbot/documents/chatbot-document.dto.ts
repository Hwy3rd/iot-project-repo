import { Expose, Type } from 'class-transformer';
import { IsString, MaxLength, MinLength, Matches } from 'class-validator';
import type { DocumentStatus } from './chatbot-document.entity';

export class UploadChatbotDocumentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  @Matches(/\S/, { message: 'Tên tài liệu không được để trống.' })
  title!: string;
}
export class ChatbotDocumentResponseDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() filename!: string;
  @Expose() mimeType!: string;
  @Expose() bytes!: number;
  @Expose() pages!: number | null;
  @Expose() status!: DocumentStatus;
  @Expose() chunkCount!: number;
  @Expose() error!: string | null;
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
}
export class ChatbotDocumentDetailDto extends ChatbotDocumentResponseDto {
  @Expose() textContent!: string;
}
export class ChatbotBuiltinDocumentDto {
  @Expose() filename!: string;
  @Expose() title!: string;
  @Expose() chunkCount!: number;
  @Expose() available!: boolean;
  @Expose() textContent?: string;
}
export class ChatbotDocumentsOverviewDto {
  @Expose()
  @Type(() => ChatbotDocumentResponseDto)
  items!: ChatbotDocumentResponseDto[];
  @Expose()
  @Type(() => ChatbotBuiltinDocumentDto)
  builtins!: ChatbotBuiltinDocumentDto[];
  @Expose() processingAvailable!: boolean;
  @Expose() knowledgeMode!: string;
  @Expose() maxDocuments!: number;
}
