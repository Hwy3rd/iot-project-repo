import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Warehouse } from '../modules/warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../modules/warehouses/entities/warehouse-staff.entity';
import { ColdRoom } from '../modules/cold-rooms/entities/cold-room.entity';
import { ProductType } from '../modules/product-types/entities/product-type.entity';
import { Batch } from '../modules/batches/entities/batch.entity';
import { Shift } from '../modules/shifts/entities/shift.entity';
import { WorkShift } from '../modules/work-shifts/entities/work-shift.entity';
import { Device } from '../modules/devices/entities/device.entity';
import { DeviceChannel } from '../modules/device-channels/entities/device-channel.entity';
import { Command } from '../modules/commands/entities/command.entity';
import { AuditLog } from '../modules/audit-logs/entities/audit-log.entity';

// Shared between the Nest app (spread into TypeOrmModule.forRoot in
// app.module.ts) and the TypeORM CLI (migration:generate/run/revert scripts
// in package.json). Keeping one definition means the app and the CLI can
// never end up pointed at different databases or entity sets.
//
// `entities` is listed explicitly (rather than relying on Nest's
// autoLoadEntities) because the CLI runs outside Nest's DI container and has
// no other way to discover them.
export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  username: process.env.MYSQL_USER ?? 'user',
  password: process.env.MYSQL_PASSWORD ?? 'password',
  database: process.env.MYSQL_DATABASE ?? 'mydatabase',
  timezone: 'Z',
  entities: [
    User,
    Warehouse,
    WarehouseStaff,
    ColdRoom,
    ProductType,
    Batch,
    Shift,
    WorkShift,
    Device,
    DeviceChannel,
    Command,
    AuditLog,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
};

const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
