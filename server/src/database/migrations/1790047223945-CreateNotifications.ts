import { MigrationInterface, QueryRunner } from 'typeorm';

// Depends on users (has its own migration) and alerts (see
// CreateAlerts1790046087629, which this migration must run after — TypeORM
// orders migrations by timestamp, and this one's is later). Also depends on
// cold_rooms/devices/batches existing for CreateAlerts' own FKs, so the same
// "no migration for those tables yet" gap noted there applies transitively
// here too.
export class CreateNotifications1790047223945 implements MigrationInterface {
  name = 'CreateNotifications1790047223945';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`push_subscriptions\` (\`id\` varchar(36) NOT NULL, \`user_id\` varchar(36) NOT NULL, \`endpoint\` varchar(512) NOT NULL, \`p256dh_key\` varchar(255) NOT NULL, \`auth_key\` varchar(255) NOT NULL, \`user_agent\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`last_used_at\` timestamp NULL, UNIQUE INDEX \`IDX_0008bdfd174e533a3f98bf9af1\` (\`endpoint\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`notifications\` (\`id\` varchar(36) NOT NULL, \`user_id\` varchar(36) NOT NULL, \`alert_id\` varchar(36) NULL, \`title\` varchar(255) NOT NULL, \`body\` text NOT NULL, \`status\` enum ('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`sent_at\` timestamp NULL, \`read_at\` timestamp NULL, INDEX \`IDX_5323ccd23482802bd9759e88ee\` (\`user_id\`, \`read_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`push_subscriptions\` ADD CONSTRAINT \`FK_6771f119f1c06d2ccf38f238664\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notifications\` ADD CONSTRAINT \`FK_9a8a82462cab47c73d25f49261f\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`notifications\` ADD CONSTRAINT \`FK_9589e72e51c4f089bb9655d3273\` FOREIGN KEY (\`alert_id\`) REFERENCES \`alerts\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`notifications\` DROP FOREIGN KEY \`FK_9589e72e51c4f089bb9655d3273\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notifications\` DROP FOREIGN KEY \`FK_9a8a82462cab47c73d25f49261f\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`push_subscriptions\` DROP FOREIGN KEY \`FK_6771f119f1c06d2ccf38f238664\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_5323ccd23482802bd9759e88ee\` ON \`notifications\``,
    );
    await queryRunner.query(`DROP TABLE \`notifications\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_0008bdfd174e533a3f98bf9af1\` ON \`push_subscriptions\``,
    );
    await queryRunner.query(`DROP TABLE \`push_subscriptions\``);
  }
}
