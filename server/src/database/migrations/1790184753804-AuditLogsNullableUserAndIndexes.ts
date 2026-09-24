import { MigrationInterface, QueryRunner } from 'typeorm';

// user_id becomes nullable so entries with no attributable user (system
// actions, failed logins for unknown usernames) can be recorded, plus
// indexes matching GET /audit-logs' filters.
//
// down() re-applies NOT NULL and refuses (before touching anything) once
// any such NULL-user entry exists — deliberately: audit_logs is append-only, so reverting must not
// silently delete history to make the constraint fit.
export class AuditLogsNullableUserAndIndexes1790184753804 implements MigrationInterface {
  name = 'AuditLogsNullableUserAndIndexes1790184753804';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` DROP FOREIGN KEY \`FK_bd2726fd31b35443f2245b93ba0\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` CHANGE \`user_id\` \`user_id\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_a358c00ae08bdea24880372d7a\` ON \`audit_logs\` (\`target_type\`, \`target_id\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_210a2d86b9165239e1ed7de79c\` ON \`audit_logs\` (\`warehouse_id\`, \`created_at\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_2f68e345c05e8166ff9deea1ab\` ON \`audit_logs\` (\`user_id\`, \`created_at\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_2cd10fda8276bb995288acfbfb\` ON \`audit_logs\` (\`created_at\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` ADD CONSTRAINT \`FK_bd2726fd31b35443f2245b93ba0\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check before any DDL: MySQL DDL isn't transactional, so failing midway
    // would leave the table half-reverted.
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM \`audit_logs\` WHERE \`user_id\` IS NULL`,
    )) as { count: string }[];
    if (Number(count) > 0) {
      throw new Error(
        `Cannot revert: ${count} audit_logs rows have no user_id and audit history must not be deleted`,
      );
    }

    // MySQL let the (warehouse_id, created_at) index replace the FK's own
    // implicit index when up() created it, so the warehouse FK has to come
    // off too before that index can be dropped; re-adding it afterwards
    // recreates its implicit index.
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` DROP FOREIGN KEY \`FK_bd2726fd31b35443f2245b93ba0\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` DROP FOREIGN KEY \`FK_627000cd20cfb797cb744fe7b8a\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_2cd10fda8276bb995288acfbfb\` ON \`audit_logs\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_2f68e345c05e8166ff9deea1ab\` ON \`audit_logs\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_210a2d86b9165239e1ed7de79c\` ON \`audit_logs\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_a358c00ae08bdea24880372d7a\` ON \`audit_logs\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` CHANGE \`user_id\` \`user_id\` varchar(36) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` ADD CONSTRAINT \`FK_bd2726fd31b35443f2245b93ba0\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` ADD CONSTRAINT \`FK_627000cd20cfb797cb744fe7b8a\` FOREIGN KEY (\`warehouse_id\`) REFERENCES \`warehouses\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
