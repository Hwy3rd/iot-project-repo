import { MigrationInterface, QueryRunner } from 'typeorm';

// Commands are now actually delivered over MQTT (CommandDispatcherService)
// and retried/expired by the worker (CommandRetryProcessor), which needs
// sent_at/attempts/expires_at/error_reason and two more final states.
//
// Rows from before this never reached a device — nothing published them —
// so open ones are closed as expired rather than suddenly sent out now.
// expires_at is backfilled from created_at before it becomes NOT NULL
// (a bare NOT NULL timestamp on existing rows fails under strict mode).
// down() folds the new states into `failed` so the old enum still fits.
export class CommandLifecycle1791004479605 implements MigrationInterface {
  name = 'CommandLifecycle1791004479605';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`commands\` ADD \`sent_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` ADD \`attempts\` int NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` ADD \`expires_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `UPDATE \`commands\` SET \`expires_at\` = \`created_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` MODIFY \`expires_at\` timestamp NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` ADD \`error_reason\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` CHANGE \`status\` \`status\` enum ('pending', 'sent', 'done', 'failed', 'expired', 'superseded') NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `UPDATE \`commands\` SET \`status\` = 'expired' WHERE \`status\` IN ('pending', 'sent')`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_fcbc4bdc970f98782d42944408\` ON \`commands\` (\`status\`, \`expires_at\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_6de9c479699e77ce1de8f080a1\` ON \`commands\` (\`channel_id\`, \`status\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_6de9c479699e77ce1de8f080a1\` ON \`commands\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_fcbc4bdc970f98782d42944408\` ON \`commands\``,
    );
    await queryRunner.query(
      `UPDATE \`commands\` SET \`status\` = 'failed' WHERE \`status\` IN ('expired', 'superseded')`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` CHANGE \`status\` \`status\` enum ('pending', 'sent', 'done', 'failed') NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` DROP COLUMN \`error_reason\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` DROP COLUMN \`expires_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` DROP COLUMN \`attempts\``,
    );
    await queryRunner.query(`ALTER TABLE \`commands\` DROP COLUMN \`sent_at\``);
  }
}
