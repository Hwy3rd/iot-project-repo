import {
  And,
  Equal,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
} from 'typeorm';
import {
  createdBetween,
  dayBetween,
  escapeLike,
  narrowWarehouseIds,
  withSearch,
} from './find-filters';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});

describe('withSearch', () => {
  type Row = { a: number; b: string; c: string };
  it('returns base unchanged without a search term', () => {
    expect(withSearch<Row>({ a: 1 }, undefined, ['b'])).toEqual({ a: 1 });
    expect(withSearch<Row>({ a: 1 }, '', ['b'])).toEqual({ a: 1 });
  });

  it('builds one OR branch per field, each carrying base', () => {
    expect(withSearch<Row>({ a: 1 }, 'x', ['b', 'c'])).toEqual([
      { a: 1, b: Like('%x%') },
      { a: 1, c: Like('%x%') },
    ]);
  });

  it('ANDs LIKE with a constraint base already has on that field', () => {
    expect(withSearch<Row>({ b: 'y' }, 'x', ['b'])).toEqual([
      { b: And(Equal('y'), Like('%x%')) },
    ]);
  });
});

describe('createdBetween', () => {
  it('is undefined without bounds', () => {
    expect(createdBetween()).toBeUndefined();
  });

  it('makes both UTC days inclusive', () => {
    expect(createdBetween('2026-09-01', '2026-09-30')).toEqual(
      And(
        MoreThanOrEqual(new Date('2026-09-01T00:00:00Z')),
        LessThan(new Date('2026-10-01T00:00:00Z')),
      ),
    );
  });

  it('supports open-ended ranges', () => {
    expect(createdBetween('2026-09-01')).toEqual(
      MoreThanOrEqual(new Date('2026-09-01T00:00:00Z')),
    );
    expect(createdBetween(undefined, '2026-12-31')).toEqual(
      LessThan(new Date('2027-01-01T00:00:00Z')),
    );
  });
});

describe('dayBetween', () => {
  it('compares DATE columns inclusively', () => {
    expect(dayBetween('2026-09-01', '2026-09-30')).toEqual(
      And(MoreThanOrEqual('2026-09-01'), LessThanOrEqual('2026-09-30')),
    );
    expect(dayBetween(undefined, '2026-09-30')).toEqual(
      LessThanOrEqual('2026-09-30'),
    );
    expect(dayBetween()).toBeUndefined();
  });
});

describe('narrowWarehouseIds', () => {
  it('passes the scope through without a filter', () => {
    expect(narrowWarehouseIds(null)).toBeUndefined();
    expect(narrowWarehouseIds(['a'])).toEqual(['a']);
  });

  it('narrows to the requested warehouse when in scope', () => {
    expect(narrowWarehouseIds(null, 'a')).toEqual(['a']);
    expect(narrowWarehouseIds(['a', 'b'], 'a')).toEqual(['a']);
  });

  it('matches nothing when the warehouse is out of scope', () => {
    expect(narrowWarehouseIds(['a'], 'b')).toEqual([]);
  });
});
