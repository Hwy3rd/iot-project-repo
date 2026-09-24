import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const notificationsService = {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    findAll: jest.fn(),
    markRead: jest.fn(),
  };
  const config = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the configured VAPID public key', () => {
    config.get.mockReturnValue('pub-key');

    expect(controller.getVapidPublicKey()).toEqual({ publicKey: 'pub-key' });
    expect(config.get).toHaveBeenCalledWith('VAPID_PUBLIC_KEY');
  });

  it('returns null when no VAPID public key is configured', () => {
    config.get.mockReturnValue(undefined);

    expect(controller.getVapidPublicKey()).toEqual({ publicKey: null });
  });

  it('subscribes for the authenticated caller', async () => {
    const dto = {
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'p', auth: 'a' },
    };

    await controller.subscribe('u1', dto);

    expect(notificationsService.subscribe).toHaveBeenCalledWith('u1', dto);
  });

  it("unsubscribes only the caller's own endpoint", async () => {
    await controller.unsubscribe('u1', { endpoint: 'https://push.example/1' });

    expect(notificationsService.unsubscribe).toHaveBeenCalledWith(
      'u1',
      'https://push.example/1',
    );
  });

  it('delegates findAll to the service, scoped to the caller', async () => {
    const query = { unreadOnly: 'true' };

    await controller.findAll('u1', query);

    expect(notificationsService.findAll).toHaveBeenCalledWith('u1', query);
  });

  it('delegates markRead to the service, scoped to the caller', async () => {
    await controller.markRead('n1', 'u1');

    expect(notificationsService.markRead).toHaveBeenCalledWith('n1', 'u1');
  });
});
