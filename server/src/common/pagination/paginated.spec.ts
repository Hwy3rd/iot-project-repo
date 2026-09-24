import { Paginated, resolvePagination } from './paginated';

describe('resolvePagination', () => {
  it('applies defaults when page/limit are omitted', () => {
    expect(resolvePagination()).toEqual({
      page: 1,
      limit: 20,
      skip: 0,
      take: 20,
    });
  });

  it('computes skip from page and limit', () => {
    expect(resolvePagination({ page: 3, limit: 10 })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
      take: 10,
    });
  });

  it('clamps out-of-range values from internal callers', () => {
    expect(resolvePagination({ page: 0, limit: 1000 })).toEqual({
      page: 1,
      limit: 100,
      skip: 0,
      take: 100,
    });
  });
});

describe('Paginated', () => {
  it('derives totalPages from total and limit', () => {
    const result = Paginated.of(['a', 'b'], 45, { page: 1, limit: 20 });
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('map transforms items and keeps meta', () => {
    const result = Paginated.of([1, 2], 2, { page: 1, limit: 20 }).map(
      (n) => n * 10,
    );
    expect(result.items).toEqual([10, 20]);
    expect(result.meta.total).toBe(2);
  });
});
