import { ValidationPipe } from '@nestjs/common';
import { UpdateBatchDto } from '../../modules/batches/dto/update-batch.dto';
import { UpdateColdRoomDto } from '../../modules/cold-rooms/dto/update-cold-room.dto';
import { UpdateWorkShiftDto } from '../../modules/work-shifts/dto/update-work-shift.dto';

// The field that places a resource in a warehouse must never be editable:
// WarehouseScopeGuard only checks the resource's *current* warehouse, so an
// editable one would let a caller move it somewhere they have no rights.
// Same pipe config as main.ts.
describe('update DTOs keep the warehouse placement immutable', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const strip = (metatype: new () => object, body: object) =>
    pipe.transform(body, { type: 'body', metatype }) as Promise<
      Record<string, unknown>
    >;

  it('drops warehouseId from a cold room update', async () => {
    const result = await strip(UpdateColdRoomDto, {
      warehouseId: 'w2',
      name: 'Kho A1',
    });
    expect(result).not.toHaveProperty('warehouseId');
    expect(result.name).toBe('Kho A1');
  });

  it('drops coldRoomId from a batch update', async () => {
    const result = await strip(UpdateBatchDto, {
      coldRoomId: 'cr-other',
      quantity: 5,
    });
    expect(result).not.toHaveProperty('coldRoomId');
    expect(result.quantity).toBe(5);
  });

  it('drops warehouseId from a work shift update but keeps staffId', async () => {
    const result = await strip(UpdateWorkShiftDto, {
      warehouseId: 'w2',
      staffId: 's2',
    });
    expect(result).not.toHaveProperty('warehouseId');
    expect(result.staffId).toBe('s2');
  });
});
