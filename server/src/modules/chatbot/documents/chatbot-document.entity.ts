import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DocumentStatus =
  'pending' | 'queued' | 'processing' | 'ready' | 'failed';
export interface DocumentEmbedding {
  model: string;
  dimensions: number;
  chunkIds: string[];
  vectors: number[][];
}

@Entity('chatbot_documents')
export class ChatbotDocument {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id!: string;
  @Column({ type: 'varchar', length: 180 }) title!: string;
  @Column({ type: 'varchar', length: 255 }) filename!: string;
  @Column({ type: 'varchar', length: 100 }) mimeType!: string;
  @Column({ type: 'int', unsigned: true }) bytes!: number;
  @Column({ type: 'int', unsigned: true, nullable: true }) pages!:
    number | null;
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: DocumentStatus;
  @Column({ type: 'int', unsigned: true, name: 'chunk_count' })
  chunkCount!: number;
  @Column({ type: 'varchar', length: 64, name: 'content_hash', unique: true })
  contentHash!: string;
  @Column({ type: 'varchar', length: 36, name: 'created_by' })
  createdBy!: string;
  @Column({
    type: 'varchar',
    length: 36,
    name: 'job_token',
    nullable: true,
    select: false,
  })
  jobToken!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) error!:
    string | null;
  @Column({ type: 'longtext', name: 'text_content', select: false })
  textContent!: string;
  @Column({
    type: 'json',
    name: 'embedding_data',
    nullable: true,
    select: false,
  })
  embeddingData!: DocumentEmbedding | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
