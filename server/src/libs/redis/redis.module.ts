import {
  Global,
  Inject,
  Module,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constant';

const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Redis({
      host: config.get<string>('REDIS_HOST') ?? 'localhost',
      port: Number(config.get<string>('REDIS_PORT') ?? 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
    }),
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  onModuleDestroy() {
    return this.client.quit();
  }
}
