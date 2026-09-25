import { MigrationInterface, QueryRunner } from 'typeorm';

// Shift templates stop being the fixed morning/afternoon/night trio: each
// gets a free name instead of a unique shift_type, so Admins can create any
// number of them (ShiftsService keeps their hours from overlapping and
// their names unique among active ones). Existing templates are named
// after their old type.
//
// down() only works while every template (soft-deleted ones included, the
// old unique index covered them too) still maps back to a distinct old
// type — it refuses before touching anything otherwise, rather than drop
// templates that past work shifts point at.
const NAMES = [
  ['morning', 'Ca sáng'],
  ['afternoon', 'Ca chiều'],
  ['night', 'Ca tối'],
] as const;

export class ShiftTemplateNames1790360000000 implements MigrationInterface {
  name = 'ShiftTemplateNames1790360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`shifts\` ADD \`name\` varchar(100) NULL`,
    );
    for (const [type, name] of NAMES) {
      await queryRunner.query(
        `UPDATE \`shifts\` SET \`name\` = ? WHERE \`shift_type\` = ?`,
        [name, type],
      );
    }
    await queryRunner.query(
      `ALTER TABLE \`shifts\` MODIFY \`name\` varchar(100) NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_2f7b7cb0b58c39f20dd7b5c2a7\` ON \`shifts\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`shifts\` DROP COLUMN \`shift_type\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check before any DDL: MySQL DDL isn't transactional.
    const names = NAMES.map(([, name]) => name);
    const [{ unmapped, duplicated }] = (await queryRunner.query(
      `SELECT
         SUM(\`name\` NOT IN (?, ?, ?)) AS unmapped,
         COUNT(*) - COUNT(DISTINCT \`name\`) AS duplicated
       FROM \`shifts\``,
      names,
    )) as { unmapped: string | null; duplicated: string }[];
    if (Number(unmapped ?? 0) > 0 || Number(duplicated) > 0) {
      throw new Error(
        `Cannot revert: shift templates must be exactly named ${names.join(', ')} (each at most once, deleted ones included) to map back onto shift_type`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE \`shifts\` ADD \`shift_type\` enum ('morning', 'afternoon', 'night') NULL`,
    );
    for (const [type, name] of NAMES) {
      await queryRunner.query(
        `UPDATE \`shifts\` SET \`shift_type\` = ? WHERE \`name\` = ?`,
        [type, name],
      );
    }
    await queryRunner.query(
      `ALTER TABLE \`shifts\` MODIFY \`shift_type\` enum ('morning', 'afternoon', 'night') NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_2f7b7cb0b58c39f20dd7b5c2a7\` ON \`shifts\` (\`shift_type\`)`,
    );
    await queryRunner.query(`ALTER TABLE \`shifts\` DROP COLUMN \`name\``);
  }
}
