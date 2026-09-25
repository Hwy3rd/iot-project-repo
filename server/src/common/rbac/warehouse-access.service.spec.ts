import { In, IsNull, MoreThan } from 'typeorm';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { WarehouseAccessService } from './warehouse-access.service';

describe('WarehouseAccessService.warehousesWithActiveShift', () => {
  const workShiftRepo = { find: jest.fn() };
  const service = new WarehouseAccessService(
    { find: jest.fn() } as never,
    workShiftRepo as never,
  );

  it('counts only approved, not checked-out shifts until 5 minutes after their end', async () => {
    workShiftRepo.find.mockResolvedValue([
      { warehouseId: 'w1' },
      { warehouseId: 'w1' },
    ]);
    const now = new Date('2026-09-25T07:03:00Z');

    await expect(
      service.warehousesWithActiveShift('u1', ['w1', 'w2'], now),
    ).resolves.toEqual(['w1']);

    expect(workShiftRepo.find).toHaveBeenCalledWith({
      where: {
        staffId: 'u1',
        warehouseId: In(['w1', 'w2']),
        status: WorkShiftStatus.APPROVED,
        checkOutAt: IsNull(),
        scheduledEndAt: MoreThan(new Date('2026-09-25T06:58:00Z')),
      },
    });
  });

  it('skips the query without any warehouse', async () => {
    workShiftRepo.find.mockClear();

    await expect(service.warehousesWithActiveShift('u1', [])).resolves.toEqual(
      [],
    );
    expect(workShiftRepo.find).not.toHaveBeenCalled();
  });
});
