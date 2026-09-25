import { MigrationInterface, QueryRunner } from 'typeorm';

// Work shifts become attendance requests: Staff check in themselves and a
// Manager approves or rejects (no more scheduling ahead). New status set
// (pending/approved/rejected/expired), who reviewed it and why it was
// rejected, and an index for the per-warehouse, per-day review list.
//
// Existing rows are kept (history), mapped onto the new statuses:
//   checked_in, completed → approved (they did work the shift);
//   scheduled, absent     → expired  (never checked in).
// down() maps back: approved → completed/checked_in by check-out,
// pending → scheduled, rejected/expired → absent.
export class WorkShiftAttendanceRequests1790346672270 implements MigrationInterface {
  name = 'WorkShiftAttendanceRequests1790346672270';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Widen the enum to both sets first so the rows can be remapped in place.
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` MODIFY \`status\` enum ('scheduled', 'checked_in', 'completed', 'absent', 'pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `UPDATE \`work_shifts\` SET \`status\` = 'approved' WHERE \`status\` IN ('checked_in', 'completed')`,
    );
    await queryRunner.query(
      `UPDATE \`work_shifts\` SET \`status\` = 'expired' WHERE \`status\` IN ('scheduled', 'absent')`,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` MODIFY \`status\` enum ('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending'`,
    );

    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` ADD \`reviewed_by\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` ADD \`reviewed_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` ADD \`reject_reason\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_2d01ebd16b5cab6dfc5ca57774\` ON \`work_shifts\` (\`warehouse_id\`, \`work_date\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` ADD CONSTRAINT \`FK_533d6ff2c792359e3ae0b82f99c\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` DROP FOREIGN KEY \`FK_533d6ff2c792359e3ae0b82f99c\``,
    );
    // MySQL dropped the warehouse_id FK's own index once the (warehouse_id,
    // work_date) one could serve it, so that FK must be re-added around the
    // drop to get its index back.
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` DROP FOREIGN KEY \`FK_8f5402e49f51d3cee5d8786bbeb\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_2d01ebd16b5cab6dfc5ca57774\` ON \`work_shifts\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` ADD CONSTRAINT \`FK_8f5402e49f51d3cee5d8786bbeb\` FOREIGN KEY (\`warehouse_id\`) REFERENCES \`warehouses\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` DROP COLUMN \`reject_reason\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` DROP COLUMN \`reviewed_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` DROP COLUMN \`reviewed_by\``,
    );

    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` MODIFY \`status\` enum ('scheduled', 'checked_in', 'completed', 'absent', 'pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'scheduled'`,
    );
    await queryRunner.query(
      `UPDATE \`work_shifts\` SET \`status\` = IF(\`check_out_at\` IS NULL, 'checked_in', 'completed') WHERE \`status\` = 'approved'`,
    );
    await queryRunner.query(
      `UPDATE \`work_shifts\` SET \`status\` = 'scheduled' WHERE \`status\` = 'pending'`,
    );
    await queryRunner.query(
      `UPDATE \`work_shifts\` SET \`status\` = 'absent' WHERE \`status\` IN ('rejected', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE \`work_shifts\` MODIFY \`status\` enum ('scheduled', 'checked_in', 'completed', 'absent') NOT NULL DEFAULT 'scheduled'`,
    );
  }
}
