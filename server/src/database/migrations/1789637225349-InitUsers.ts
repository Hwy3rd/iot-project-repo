import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitUsers1789637225349 implements MigrationInterface {
  name = 'InitUsers1789637225349';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`username\` varchar(255) NOT NULL, \`email\` varchar(255) NULL, \`phone\` varchar(255) NULL, \`password_hash\` varchar(255) NOT NULL, \`full_name\` varchar(255) NULL, \`role\` enum ('admin', 'manager', 'staff') NOT NULL, \`status\` enum ('active', 'locked') NOT NULL DEFAULT 'active', \`password_changed_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`last_login_at\` timestamp NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_fe0bb3f6520ee0469504521e71\` (\`username\`), UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_fe0bb3f6520ee0469504521e71\` ON \`users\``,
    );
    await queryRunner.query(`DROP TABLE \`users\``);
  }
}
