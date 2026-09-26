import { MigrationInterface, QueryRunner } from 'typeorm';

// A user's role is their account role everywhere: warehouse_staff only
// records which warehouses they work in. Every assignment already matched
// its user's role (WarehouseStaffService.assign enforced Staff ⇔ Staff, and
// no Manager/Technician was mixed), so dropping the column changes nobody's
// permissions. down() restores it from users.role.
export class DropWarehouseStaffRole1790400000000 implements MigrationInterface {
  name = 'DropWarehouseStaffRole1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`warehouse_staff\` DROP COLUMN \`role\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`warehouse_staff\` ADD \`role\` enum ('admin', 'manager', 'staff', 'technician') NULL`,
    );
    await queryRunner.query(
      `UPDATE \`warehouse_staff\` ws JOIN \`users\` u ON u.\`id\` = ws.\`user_id\` SET ws.\`role\` = u.\`role\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`warehouse_staff\` MODIFY \`role\` enum ('admin', 'manager', 'staff', 'technician') NOT NULL`,
    );
  }
}
