import { Test, TestingModule } from '@nestjs/testing';
import { WEB_PUSH_CLIENT } from './web-push.constant';
import { WebPushService } from './web-push.service';

describe('WebPushService', () => {
  let service: WebPushService;
  let client: { sendNotification: jest.Mock };

  beforeEach(async () => {
    client = { sendNotification: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebPushService,
        { provide: WEB_PUSH_CLIENT, useValue: client },
      ],
    }).compile();

    service = module.get(WebPushService);
  });

  describe('send', () => {
    it('maps the flat subscription shape into the web-push endpoint/keys shape', async () => {
      client.sendNotification.mockResolvedValue(undefined);

      await service.send(
        { endpoint: 'https://push.example/1', p256dhKey: 'p', authKey: 'a' },
        '{"title":"x"}',
      );

      expect(client.sendNotification).toHaveBeenCalledWith(
        {
          endpoint: 'https://push.example/1',
          keys: { p256dh: 'p', auth: 'a' },
        },
        '{"title":"x"}',
      );
    });
  });

  describe('isGone', () => {
    it.each([404, 410])(
      'treats statusCode %d as permanently gone',
      (statusCode) => {
        expect(service.isGone({ statusCode })).toBe(true);
      },
    );

    it.each([undefined, null, 500, 429, 'nope', {}])(
      'does not treat %p as gone',
      (value) => {
        expect(service.isGone({ statusCode: value })).toBe(false);
      },
    );

    it('handles a non-object error', () => {
      expect(service.isGone(new Error('boom'))).toBe(false);
    });
  });
});
