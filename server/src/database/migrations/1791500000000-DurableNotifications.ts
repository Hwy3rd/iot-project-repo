import { MigrationInterface, QueryRunner } from 'typeorm';

export class DurableNotifications1791500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE notifications
      ADD dedupe_key varchar(73) NULL,
      ADD delivery_prepared_at datetime NULL,
      ADD UNIQUE INDEX UQ_notification_dedupe (dedupe_key),
      ADD INDEX IDX_notification_prepared (delivery_prepared_at, created_at)`);
    // Preserve all historical duplicates. Only their canonical row gets a key.
    await queryRunner.query(`UPDATE notifications n JOIN
      (SELECT alert_id, user_id, COALESCE(MIN(CASE WHEN status = 'sent' THEN id END), MIN(id)) id FROM
        (SELECT id, alert_id, user_id, status FROM notifications) AS snapshot
        WHERE alert_id IS NOT NULL GROUP BY alert_id, user_id) canonical
      ON n.id = canonical.id SET n.dedupe_key = CONCAT(n.alert_id, ':', n.user_id)`);
    // Recover recent pending/failed records; never resend successful or duplicate rows.
    await queryRunner.query(`UPDATE notifications SET delivery_prepared_at = created_at
      WHERE status = 'sent' OR created_at < UTC_TIMESTAMP() - INTERVAL 6 HOUR
      OR (alert_id IS NOT NULL AND dedupe_key IS NULL)`);
    await queryRunner.query(`CREATE TABLE notification_outbox (
      id varchar(36) NOT NULL PRIMARY KEY,
      recipients json NOT NULL, title varchar(255) NOT NULL, body text NOT NULL,
      created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), processed_at datetime NULL,
      INDEX IDX_outbox_pending (processed_at, created_at)
    ) ENGINE=InnoDB`);
    await queryRunner.query(`CREATE TABLE notification_deliveries (
      id varchar(36) NOT NULL PRIMARY KEY, notification_id varchar(36) NOT NULL,
      subscription_id varchar(36) NOT NULL,
      status enum('pending','sent','failed','expired') NOT NULL DEFAULT 'pending',
      attempts int NOT NULL DEFAULT 0, next_attempt_at datetime NOT NULL,
      expires_at datetime NOT NULL, lease_token varchar(36) NULL,
      sent_at datetime NULL, last_error varchar(255) NULL,
      UNIQUE INDEX UQ_delivery_target (notification_id, subscription_id),
      INDEX IDX_delivery_due (status, next_attempt_at)
    ) ENGINE=InnoDB`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting discards only the new recovery bookkeeping, not historical notifications.
    await queryRunner.query('DROP TABLE notification_deliveries');
    await queryRunner.query('DROP TABLE notification_outbox');
    await queryRunner.query(`ALTER TABLE notifications
      DROP INDEX UQ_notification_dedupe, DROP INDEX IDX_notification_prepared,
      DROP COLUMN dedupe_key, DROP COLUMN delivery_prepared_at`);
  }
}
