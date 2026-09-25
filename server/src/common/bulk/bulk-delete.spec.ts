import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { assertInScope, bulkDelete } from './bulk-delete';

describe('bulkDelete', () => {
  it('reports deleted ids and per-id failures, continuing past errors', async () => {
    const removeOne = jest.fn((id: string) => {
      if (id === 'b') throw new NotFoundException('Batch b not found');
      if (id === 'c')
        throw new ConflictException('Batch c was already removed');
      return Promise.resolve();
    });

    await expect(bulkDelete(['a', 'b', 'c', 'd'], removeOne)).resolves.toEqual({
      deleted: ['a', 'd'],
      failed: [
        { id: 'b', statusCode: 404, message: 'Batch b not found' },
        { id: 'c', statusCode: 409, message: 'Batch c was already removed' },
      ],
    });
    expect(removeOne).toHaveBeenCalledTimes(4);
  });

  it('propagates unexpected errors instead of reporting them', async () => {
    await expect(
      bulkDelete(['a'], () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow('db down');
  });
});

describe('assertInScope', () => {
  const warehouseOf = new Map<string, string | null>([
    ['in', 'w1'],
    ['out', 'w2'],
    ['orphan', null],
  ]);

  it('lets Admin (null scope) through for any existing row', () => {
    expect(() => assertInScope('out', warehouseOf, null)).not.toThrow();
    expect(() => assertInScope('orphan', warehouseOf, null)).not.toThrow();
  });

  it('rejects rows outside the scope or without a warehouse', () => {
    expect(() => assertInScope('in', warehouseOf, ['w1'])).not.toThrow();
    expect(() => assertInScope('out', warehouseOf, ['w1'])).toThrow(
      ForbiddenException,
    );
    expect(() => assertInScope('orphan', warehouseOf, ['w1'])).toThrow(
      ForbiddenException,
    );
  });

  it('reports a missing row as not found before checking scope', () => {
    expect(() => assertInScope('ghost', warehouseOf, ['w1'])).toThrow(
      NotFoundException,
    );
  });
});
