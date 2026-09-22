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

  it('delegates subscribe to the service', async () => {
    const dto = {
      userId: 'u1',
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'p', auth: 'a' },
    };

    await controller.subscribe(dto);

    expect(notificationsService.subscribe).toHaveBeenCalledWith(dto);
  });

  it('delegates unsubscribe to the service with just the endpoint', async () => {
    await controller.unsubscribe({ endpoint: 'https://push.example/1' });

    expect(notificationsService.unsubscribe).toHaveBeenCalledWith(
      'https://push.example/1',
    );
  });

  it('delegates findAll to the service with the query', async () => {
    const query = { userId: 'u1', unreadOnly: 'true' };

    await controller.findAll(query);

    expect(notificationsService.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates markRead to the service', async () => {
    await controller.markRead('n1', { userId: 'u1' });

    expect(notificationsService.markRead).toHaveBeenCalledWith('n1', 'u1');
  });
});
