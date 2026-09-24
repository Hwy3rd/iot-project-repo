import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatbotTables1790184728763 implements MigrationInterface {
  name = 'CreateChatbotTables1790184728763';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`chatbot_conversations\` (\`id\` varchar(36) NOT NULL, \`user_id\` varchar(36) NOT NULL, \`title\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`last_message_at\` timestamp NULL, INDEX \`IDX_6614b78e3735ac08afa9dc5f79\` (\`user_id\`, \`last_message_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`chatbot_messages\` (\`id\` varchar(36) NOT NULL, \`conversation_id\` varchar(36) NOT NULL, \`role\` enum ('user', 'assistant', 'tool', 'system') NOT NULL, \`content\` text NULL, \`tool_calls\` json NULL, \`tool_call_id\` varchar(64) NULL, \`tool_name\` varchar(100) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_f4887f40655fe3635c0700682d\` (\`conversation_id\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`chatbot_conversations\` ADD CONSTRAINT \`FK_04587ca7b98d66cb1684d38b3b2\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`chatbot_messages\` ADD CONSTRAINT \`FK_ecbbbe01809bbb761a8dc89c864\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`chatbot_conversations\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`chatbot_messages\` DROP FOREIGN KEY \`FK_ecbbbe01809bbb761a8dc89c864\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`chatbot_conversations\` DROP FOREIGN KEY \`FK_04587ca7b98d66cb1684d38b3b2\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_f4887f40655fe3635c0700682d\` ON \`chatbot_messages\``,
    );
    await queryRunner.query(`DROP TABLE \`chatbot_messages\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_6614b78e3735ac08afa9dc5f79\` ON \`chatbot_conversations\``,
    );
    await queryRunner.query(`DROP TABLE \`chatbot_conversations\``);
  }
}
