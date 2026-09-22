import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { WEB_PUSH_CLIENT } from './web-push.constant';

const logger = new Logger('WebPushModule');

const webPushProvider: Provider = {
  provide: WEB_PUSH_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
    if (publicKey && privateKey) {
      webpush.setVapidDetails(
        config.get<string>('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
        publicKey,
        privateKey,
      );
    } else {
      // Don't crash at boot over this — most of the app works fine without
      // it. Only WebPushService.send() fails, once something actually tries
      // to push. Generate a pair with `npx web-push generate-vapid-keys`.
      logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push sends will fail until configured.',
      );
    }
    return webpush;
  },
};

// Not @Global(): the only consumer is AlertNotificationProcessor, imported
// once by WorkerModule — unlike MinioModule/RedisModule this has no reason
// to be reachable from every module.
@Module({
  imports: [ConfigModule],
  providers: [webPushProvider],
  exports: [WEB_PUSH_CLIENT],
})
export class WebPushModule {}
