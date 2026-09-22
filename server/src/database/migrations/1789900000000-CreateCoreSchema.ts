import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCoreSchema1789900000000 implements MigrationInterface {
    name = 'CreateCoreSchema1789900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`cold_rooms\` (\`id\` varchar(36) NOT NULL, \`warehouse_id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`temp_min\` decimal(5,2) NOT NULL, \`temp_max\` decimal(5,2) NOT NULL, \`hysteresis\` decimal(5,2) NOT NULL DEFAULT '1.00', \`door_open_max_seconds\` int NOT NULL DEFAULT '15', \`capacity_pallets\` int NULL, \`capacity_weight_kg\` decimal(10,2) NULL, \`capacity_volume_m3\` decimal(10,2) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_a9567b2d21b9b6c46b982c07f5\` (\`warehouse_id\`, \`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`warehouse_staff\` (\`user_id\` varchar(36) NOT NULL, \`warehouse_id\` varchar(36) NOT NULL, \`role\` enum ('admin', 'manager', 'staff', 'technician') NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`user_id\`, \`warehouse_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`warehouses\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`code\` varchar(255) NOT NULL, \`address\` varchar(255) NULL, \`image_urls\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_be9dd3cc2931f11f7440f2eeb1\` (\`name\`), UNIQUE INDEX \`IDX_d8b96d60ff9a288f5ed862280d\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`product_types\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`category\` varchar(255) NULL, \`unit\` enum ('kg', 'liter', 'piece', 'box') NOT NULL, \`image_urls\` json NULL, \`storage_temp_min\` decimal(5,2) NULL, \`storage_temp_max\` decimal(5,2) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_2b3bfea1c7797e9d067dfc3c7a\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`batches\` (\`id\` varchar(36) NOT NULL, \`cold_room_id\` varchar(36) NOT NULL, \`product_type_id\` varchar(36) NOT NULL, \`batch_code\` varchar(255) NOT NULL, \`quantity\` decimal(10,2) NOT NULL, \`supplier\` varchar(255) NULL, \`received_at\` date NOT NULL, \`expiry_date\` date NOT NULL, \`removed_at\` date NULL, \`status\` enum ('in_stock', 'expired', 'removed') NOT NULL DEFAULT 'in_stock', \`notes\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_19c83ff4eccd9bbbb9a75f5ef7\` (\`cold_room_id\`, \`batch_code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`shifts\` (\`id\` varchar(36) NOT NULL, \`shift_type\` enum ('morning', 'afternoon', 'night') NOT NULL, \`start_time\` time NOT NULL, \`end_time\` time NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_2f7b7cb0b58c39f20dd7b5c2a7\` (\`shift_type\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`work_shifts\` (\`id\` varchar(36) NOT NULL, \`shift_id\` varchar(36) NOT NULL, \`staff_id\` varchar(36) NOT NULL, \`warehouse_id\` varchar(36) NOT NULL, \`work_date\` date NOT NULL, \`scheduled_start_at\` timestamp NOT NULL, \`scheduled_end_at\` timestamp NOT NULL, \`status\` enum ('scheduled', 'checked_in', 'completed', 'absent') NOT NULL DEFAULT 'scheduled', \`check_in_at\` timestamp NULL, \`check_out_at\` timestamp NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_7fb51214053c1680600e2c7322\` (\`staff_id\`, \`work_date\`, \`shift_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`devices\` (\`id\` varchar(36) NOT NULL, \`unique_id\` varchar(255) NOT NULL, \`cold_room_id\` varchar(36) NULL, \`firmware_version\` varchar(255) NULL, \`status\` enum ('registered', 'provisioned', 'active', 'offline', 'fault', 'maintenance', 'decommissioned') NOT NULL DEFAULT 'registered', \`last_heartbeat_at\` timestamp NULL, \`claim_code_hash\` varchar(255) NULL, \`claim_code_expires_at\` timestamp NULL, \`claimed_at\` timestamp NULL, \`decommissioned_at\` timestamp NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_d866d7556ff7221a4d59dc0252\` (\`unique_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`device_channels\` (\`id\` varchar(36) NOT NULL, \`device_id\` varchar(36) NOT NULL, \`channel_type\` enum ('limit_switch', 'temp_humidity_sensor', 'current_sensor', 'fan_motor', 'indicator_light', 'buzzer') NOT NULL, \`channel_role\` enum ('sensor', 'actuator') NOT NULL, \`label\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`commands\` (\`id\` varchar(36) NOT NULL, \`channel_id\` varchar(36) NOT NULL, \`issued_by\` varchar(36) NULL, \`action\` enum ('on', 'off') NOT NULL, \`payload\` json NULL, \`status\` enum ('pending', 'sent', 'done', 'failed') NOT NULL DEFAULT 'pending', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`ack_at\` timestamp NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`audit_logs\` (\`id\` varchar(36) NOT NULL, \`user_id\` varchar(36) NOT NULL, \`warehouse_id\` varchar(36) NULL, \`action\` varchar(255) NOT NULL, \`target_type\` varchar(255) NULL, \`target_id\` varchar(36) NULL, \`metadata\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`image_urls\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`role\` \`role\` enum ('admin', 'manager', 'staff', 'technician') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`cold_rooms\` ADD CONSTRAINT \`FK_bc7449cd89d7873c94f026ba287\` FOREIGN KEY (\`warehouse_id\`) REFERENCES \`warehouses\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`warehouse_staff\` ADD CONSTRAINT \`FK_5912ffb8eb9008e558245ea629c\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`warehouse_staff\` ADD CONSTRAINT \`FK_473e97b3fc433e5a55a0f8e58ed\` FOREIGN KEY (\`warehouse_id\`) REFERENCES \`warehouses\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`batches\` ADD CONSTRAINT \`FK_e3198ade3268df6398a7b909c2a\` FOREIGN KEY (\`cold_room_id\`) REFERENCES \`cold_rooms\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`batches\` ADD CONSTRAINT \`FK_2f383397c317420ead87f6c339b\` FOREIGN KEY (\`product_type_id\`) REFERENCES \`product_types\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`work_shifts\` ADD CONSTRAINT \`FK_9959299d9b8d3cece36e207b449\` FOREIGN KEY (\`shift_id\`) REFERENCES \`shifts\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`work_shifts\` ADD CONSTRAINT \`FK_aa782e01c38f62ada54f551991c\` FOREIGN KEY (\`staff_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`work_shifts\` ADD CONSTRAINT \`FK_8f5402e49f51d3cee5d8786bbeb\` FOREIGN KEY (\`warehouse_id\`) REFERENCES \`warehouses\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`devices\` ADD CONSTRAINT \`FK_327664a4fe0c787d487a0295195\` FOREIGN KEY (\`cold_room_id\`) REFERENCES \`cold_rooms\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`device_channels\` ADD CONSTRAINT \`FK_88b66aaab27cc147d4748ec08d4\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`commands\` ADD CONSTRAINT \`FK_26e83653be58e7be0366c547897\` FOREIGN KEY (\`channel_id\`) REFERENCES \`device_channels\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`commands\` ADD CONSTRAINT \`FK_e20a837370c40356fe65ae16c9b\` FOREIGN KEY (\`issued_by\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`audit_logs\` ADD CONSTRAINT \`FK_bd2726fd31b35443f2245b93ba0\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`audit_logs\` ADD CONSTRAINT \`FK_627000cd20cfb797cb744fe7b8a\` FOREIGN KEY (\`warehouse_id\`) REFERENCES \`warehouses\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`audit_logs\` DROP FOREIGN KEY \`FK_627000cd20cfb797cb744fe7b8a\``);
        await queryRunner.query(`ALTER TABLE \`audit_logs\` DROP FOREIGN KEY \`FK_bd2726fd31b35443f2245b93ba0\``);
        await queryRunner.query(`ALTER TABLE \`commands\` DROP FOREIGN KEY \`FK_e20a837370c40356fe65ae16c9b\``);
        await queryRunner.query(`ALTER TABLE \`commands\` DROP FOREIGN KEY \`FK_26e83653be58e7be0366c547897\``);
        await queryRunner.query(`ALTER TABLE \`device_channels\` DROP FOREIGN KEY \`FK_88b66aaab27cc147d4748ec08d4\``);
        await queryRunner.query(`ALTER TABLE \`devices\` DROP FOREIGN KEY \`FK_327664a4fe0c787d487a0295195\``);
        await queryRunner.query(`ALTER TABLE \`work_shifts\` DROP FOREIGN KEY \`FK_8f5402e49f51d3cee5d8786bbeb\``);
        await queryRunner.query(`ALTER TABLE \`work_shifts\` DROP FOREIGN KEY \`FK_aa782e01c38f62ada54f551991c\``);
        await queryRunner.query(`ALTER TABLE \`work_shifts\` DROP FOREIGN KEY \`FK_9959299d9b8d3cece36e207b449\``);
        await queryRunner.query(`ALTER TABLE \`batches\` DROP FOREIGN KEY \`FK_2f383397c317420ead87f6c339b\``);
        await queryRunner.query(`ALTER TABLE \`batches\` DROP FOREIGN KEY \`FK_e3198ade3268df6398a7b909c2a\``);
        await queryRunner.query(`ALTER TABLE \`warehouse_staff\` DROP FOREIGN KEY \`FK_473e97b3fc433e5a55a0f8e58ed\``);
        await queryRunner.query(`ALTER TABLE \`warehouse_staff\` DROP FOREIGN KEY \`FK_5912ffb8eb9008e558245ea629c\``);
        await queryRunner.query(`ALTER TABLE \`cold_rooms\` DROP FOREIGN KEY \`FK_bc7449cd89d7873c94f026ba287\``);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`role\` \`role\` enum ('admin', 'manager', 'staff') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`image_urls\``);
        await queryRunner.query(`DROP TABLE \`audit_logs\``);
        await queryRunner.query(`DROP TABLE \`commands\``);
        await queryRunner.query(`DROP TABLE \`device_channels\``);
        await queryRunner.query(`DROP INDEX \`IDX_d866d7556ff7221a4d59dc0252\` ON \`devices\``);
        await queryRunner.query(`DROP TABLE \`devices\``);
        await queryRunner.query(`DROP INDEX \`IDX_7fb51214053c1680600e2c7322\` ON \`work_shifts\``);
        await queryRunner.query(`DROP TABLE \`work_shifts\``);
        await queryRunner.query(`DROP INDEX \`IDX_2f7b7cb0b58c39f20dd7b5c2a7\` ON \`shifts\``);
        await queryRunner.query(`DROP TABLE \`shifts\``);
        await queryRunner.query(`DROP INDEX \`IDX_19c83ff4eccd9bbbb9a75f5ef7\` ON \`batches\``);
        await queryRunner.query(`DROP TABLE \`batches\``);
        await queryRunner.query(`DROP INDEX \`IDX_2b3bfea1c7797e9d067dfc3c7a\` ON \`product_types\``);
        await queryRunner.query(`DROP TABLE \`product_types\``);
        await queryRunner.query(`DROP INDEX \`IDX_d8b96d60ff9a288f5ed862280d\` ON \`warehouses\``);
        await queryRunner.query(`DROP INDEX \`IDX_be9dd3cc2931f11f7440f2eeb1\` ON \`warehouses\``);
        await queryRunner.query(`DROP TABLE \`warehouses\``);
        await queryRunner.query(`DROP TABLE \`warehouse_staff\``);
        await queryRunner.query(`DROP INDEX \`IDX_a9567b2d21b9b6c46b982c07f5\` ON \`cold_rooms\``);
        await queryRunner.query(`DROP TABLE \`cold_rooms\``);
    }

}
