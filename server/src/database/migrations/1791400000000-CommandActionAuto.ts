import { MigrationInterface, QueryRunner } from 'typeorm';

// `auto` hands an actuator back to the device's own logic (ends a manual
// on/off override early). down() can't keep those rows under the old enum,
// so it removes them — they are history of a feature that no longer exists.
export class CommandActionAuto1791400000000 implements MigrationInterface {
  name = 'CommandActionAuto1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`commands\` CHANGE \`action\` \`action\` enum ('on', 'off', 'auto') NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`commands\` WHERE \`action\` = 'auto'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`commands\` CHANGE \`action\` \`action\` enum ('on', 'off') NOT NULL`,
    );
  }
}
