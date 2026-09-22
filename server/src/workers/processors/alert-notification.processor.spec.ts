import { Job } from 'bullmq';
import { WebPushService } from '../../libs/web-push/web-push.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import {
  AlertNotificationJobData,
  AlertNotificationProcessor,
} from './alert-notification.processor';

describe('AlertNotificationProcessor', () => {
  let processor: AlertNotificationProcessor;
  const alertsRepository = { findOne: jest.fn() };
  const subscriptionsRepository = {
    find: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const notificationsRepository = { update: jest.fn() };
  const notificationsService = { notifyNewAlert: jest.fn() };
  const webPush = { send: jest.fn(), isGone: jest.fn() };

  const jobWith = (data: AlertNotificationJobData) =>
    ({ data }) as Job<AlertNotificationJobData>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new AlertNotificationProcessor(
      alertsRepository as never,
      subscriptionsRepository as never,
      notificationsRepository as never,
      notificationsService as unknown as NotificationsService,
      webPush as unknown as WebPushService,
    );
  });

  describe('process', () => {
    it('skips silently when the alert no longer exists', async () => {
      alertsRepository.findOne.mockResolvedValue(null);

      await processor.process(jobWith({ alertId: 'missing' }));

      expect(notificationsService.notifyNewAlert).not.toHaveBeenCalled();
    });

    it('resolves recipients then delivers each notification', async () => {
      alertsRepository.findOne.mockResolvedValue({ id: 'al1' });
      notificationsService.notifyNewAlert.mockResolvedValue([
        { id: 'n1', userId: 'u1' },
        { id: 'n2', userId: 'u2' },
      ]);
      subscriptionsRepository.find.mockResolvedValue([]);

      await processor.process(jobWith({ alertId: 'al1' }));

      expect(notificationsService.notifyNewAlert).toHaveBeenCalledWith({
        id: 'al1',
      });
      expect(subscriptionsRepository.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('deliver (via process)', () => {
    const alert = { id: 'al1' };
    const notification = {
      id: 'n1',
      userId: 'u1',
      title: 't',
      body: 'b',
      alertId: 'al1',
    };

    beforeEach(() => {
      alertsRepository.findOne.mockResolvedValue(alert);
      notificationsService.notifyNewAlert.mockResolvedValue([notification]);
    });

    it('marks the notification failed with no sentAt when the user has no subscriptions', async () => {
      subscriptionsRepository.find.mockResolvedValue([]);

      await processor.process(jobWith({ alertId: 'al1' }));

      expect(notificationsRepository.update).toHaveBeenCalledWith('n1', {
        status: NotificationStatus.FAILED,
      });
      expect(webPush.send).not.toHaveBeenCalled();
    });

    it('marks sent once at least one subscription accepts the push', async () => {
      subscriptionsRepository.find.mockResolvedValue([
        { id: 's1', endpoint: 'e1' },
        { id: 's2', endpoint: 'e2' },
      ]);
      webPush.send.mockRejectedValueOnce(new Error('network blip'));
      webPush.send.mockResolvedValueOnce(undefined);
      webPush.isGone.mockReturnValue(false);

      await processor.process(jobWith({ alertId: 'al1' }));

      expect(notificationsRepository.update).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({ status: NotificationStatus.SENT }),
      );
      // Only the subscription that actually accepted the push is touched.
      expect(subscriptionsRepository.update).toHaveBeenCalledTimes(1);
      expect(subscriptionsRepository.delete).not.toHaveBeenCalled();
    });

    it('deletes a subscription the push service reports as gone (404/410)', async () => {
      subscriptionsRepository.find.mockResolvedValue([
        { id: 's1', endpoint: 'e1' },
      ]);
      const goneError = { statusCode: 410 };
      webPush.send.mockRejectedValue(goneError);
      webPush.isGone.mockImplementation((error) => error === goneError);

      await processor.process(jobWith({ alertId: 'al1' }));

      expect(subscriptionsRepository.delete).toHaveBeenCalledWith('s1');
      expect(notificationsRepository.update).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({
          status: NotificationStatus.FAILED,
          sentAt: null,
        }),
      );
    });

    it('keeps a subscription that failed for a non-gone reason (e.g. transient 5xx)', async () => {
      subscriptionsRepository.find.mockResolvedValue([
        { id: 's1', endpoint: 'e1' },
      ]);
      webPush.send.mockRejectedValue(new Error('502'));
      webPush.isGone.mockReturnValue(false);

      await processor.process(jobWith({ alertId: 'al1' }));

      expect(subscriptionsRepository.delete).not.toHaveBeenCalled();
      expect(notificationsRepository.update).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({ status: NotificationStatus.FAILED }),
      );
    });
  });
});
