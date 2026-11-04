import { AlertNotificationProcessor } from './alert-notification.processor';

describe('AlertNotificationProcessor', () => {
  it('delegates to durable recovery; DB failures remain failures for BullMQ retry', async () => {
    const recovery = { processAlert: jest.fn(), sweep: jest.fn() };
    const processor = new AlertNotificationProcessor(recovery as never);
    await processor.process({ data: { alertId: 'a1' } } as never);
    expect(recovery.processAlert).toHaveBeenCalledWith('a1');
    expect(recovery.sweep).toHaveBeenCalledTimes(1);
    recovery.processAlert.mockRejectedValue(new Error('MySQL down'));
    await expect(
      processor.process({ data: { alertId: 'a1' } } as never),
    ).rejects.toThrow('MySQL down');
  });
});
