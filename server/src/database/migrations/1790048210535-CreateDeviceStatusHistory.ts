import { MigrationInterface, QueryRunner } from 'typeorm';

// Depends on devices (no migration of its own yet — see CreateAlerts'
// header comment for the same gap) and users (has InitUsers).
export class CreateDeviceStatusHistory1790048210535 implements MigrationInterface {
  name = 'CreateDeviceStatusHistory1790048210535';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`device_status_history\` (\`id\` varchar(36) NOT NULL, \`device_id\` varchar(36) NOT NULL, \`old_status\` enum ('registered', 'provisioned', 'active', 'offline', 'fault', 'maintenance', 'decommissioned') NULL, \`new_status\` enum ('registered', 'provisioned', 'active', 'offline', 'fault', 'maintenance', 'decommissioned') NOT NULL, \`changed_by\` varchar(36) NULL, \`trigger\` enum ('manual', 'automated') NOT NULL, \`reason\` varchar(255) NULL, \`changed_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_bb55edeb52820e27e236e89c6d\` (\`device_id\`, \`changed_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`device_status_history\` ADD CONSTRAINT \`FK_acfee515d08def526baa0752af9\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`device_status_history\` ADD CONSTRAINT \`FK_fb2d34558b1b74ed86be20755fd\` FOREIGN KEY (\`changed_by\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`device_status_history\` DROP FOREIGN KEY \`FK_fb2d34558b1b74ed86be20755fd\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`device_status_history\` DROP FOREIGN KEY \`FK_acfee515d08def526baa0752af9\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_bb55edeb52820e27e236e89c6d\` ON \`device_status_history\``,
    );
    await queryRunner.query(`DROP TABLE \`device_status_history\``);
  }
}
