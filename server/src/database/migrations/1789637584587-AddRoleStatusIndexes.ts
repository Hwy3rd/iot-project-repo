import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleStatusIndexes1789637584587 implements MigrationInterface {
  name = 'AddRoleStatusIndexes1789637584587';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX \`IDX_ace513fa30d485cfd25c11a9e4\` ON \`users\` (\`role\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_3676155292d72c67cd4e090514\` ON \`users\` (\`status\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_3676155292d72c67cd4e090514\` ON \`users\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_ace513fa30d485cfd25c11a9e4\` ON \`users\``,
    );
  }
}
