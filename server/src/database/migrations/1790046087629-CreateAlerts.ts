import { MigrationInterface, QueryRunner } from 'typeorm';

// Depends on cold_rooms/devices/batches/users already existing. Those four
// tables don't have their own migrations yet (only `users` does — see
// InitUsers) — this migration was written and verified against a database
// where they exist (via schema sync in a throwaway container, not a
// committed migration for them, which is out of scope here). Running
// `migration:run` on a genuinely empty database will fail on the FK
// constraints below until that separate gap is fixed.
export class CreateAlerts1790046087629 implements MigrationInterface {
  name = 'CreateAlerts1790046087629';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`alerts\` (\`id\` varchar(36) NOT NULL, \`cold_room_id\` varchar(36) NOT NULL, \`device_id\` varchar(36) NULL, \`batch_id\` varchar(36) NULL, \`type\` enum ('temperature_out_of_range', 'temperature_predicted', 'device_fault', 'offline', 'door_open_too_long', 'batch_temperature_out_of_range', 'batch_expiring_soon') NOT NULL, \`status\` enum ('open', 'acknowledged', 'resolved') NOT NULL DEFAULT 'open', \`active_key\` varchar(255) NULL, \`trigger_value\` decimal(10,2) NULL, \`threshold\` decimal(10,2) NULL, \`details\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`acknowledged_by\` varchar(36) NULL, \`acknowledged_at\` timestamp NULL, \`resolved_by\` varchar(36) NULL, \`resolved_at\` timestamp NULL, \`resolution\` enum ('auto', 'manual') NULL, \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_5b5f56bba79920c45b7a5dadf1\` (\`cold_room_id\`, \`status\`, \`created_at\`), UNIQUE INDEX \`IDX_e62c298ef20b99431ea9377ad1\` (\`active_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    // Not expressible via a TypeORM column/index decorator in this version —
    // written by hand. Requires MySQL 8.0.16+ (docker-compose uses mysql:8.0).
    await queryRunner.query(
      `ALTER TABLE \`alerts\` ADD CONSTRAINT \`CHK_alerts_device_or_batch\` CHECK (\`device_id\` IS NOT NULL OR \`batch_id\` IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` ADD CONSTRAINT \`FK_1c9aa4e1258152fdb44ab1ddfdd\` FOREIGN KEY (\`cold_room_id\`) REFERENCES \`cold_rooms\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` ADD CONSTRAINT \`FK_bde35b32d03b804b0944331ac85\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` ADD CONSTRAINT \`FK_9bbfb58ca0db5e9d5fdf5dbfae0\` FOREIGN KEY (\`batch_id\`) REFERENCES \`batches\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` ADD CONSTRAINT \`FK_70e5404e97a308f93a591991dbd\` FOREIGN KEY (\`acknowledged_by\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` ADD CONSTRAINT \`FK_41046b61b52edd41a1ba24079e4\` FOREIGN KEY (\`resolved_by\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`alerts\` DROP FOREIGN KEY \`FK_41046b61b52edd41a1ba24079e4\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` DROP FOREIGN KEY \`FK_70e5404e97a308f93a591991dbd\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` DROP FOREIGN KEY \`FK_9bbfb58ca0db5e9d5fdf5dbfae0\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` DROP FOREIGN KEY \`FK_bde35b32d03b804b0944331ac85\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` DROP FOREIGN KEY \`FK_1c9aa4e1258152fdb44ab1ddfdd\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`alerts\` DROP CHECK \`CHK_alerts_device_or_batch\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_e62c298ef20b99431ea9377ad1\` ON \`alerts\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_5b5f56bba79920c45b7a5dadf1\` ON \`alerts\``,
    );
    await queryRunner.query(`DROP TABLE \`alerts\``);
  }
}
