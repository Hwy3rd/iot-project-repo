import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';

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
  entities: [User],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
};

const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
