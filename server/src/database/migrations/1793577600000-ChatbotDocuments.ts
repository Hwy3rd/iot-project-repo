import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatbotDocuments1793577600000 implements MigrationInterface {
  name = 'ChatbotDocuments1793577600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`chatbot_documents\` (
      \`id\` varchar(36) NOT NULL,
      \`title\` varchar(180) NOT NULL,
      \`filename\` varchar(255) NOT NULL,
      \`mimeType\` varchar(100) NOT NULL,
      \`bytes\` int UNSIGNED NOT NULL,
      \`pages\` int UNSIGNED NULL,
      \`status\` varchar(16) NOT NULL DEFAULT 'pending',
      \`chunk_count\` int UNSIGNED NOT NULL,
      \`content_hash\` varchar(64) NOT NULL,
      \`created_by\` varchar(36) NOT NULL,
      \`job_token\` varchar(36) NULL,
      \`error\` varchar(500) NULL,
      \`text_content\` longtext NOT NULL,
      \`embedding_data\` json NULL,
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      UNIQUE INDEX \`IDX_0305f15c5bf28359f93a8b167d\` (\`content_hash\`),
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `chatbot_documents`');
  }
}
