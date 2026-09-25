import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BooleanStringParam,
  DateParam,
  SearchParam,
} from './query-params.decorator';

class Sample {
  @SearchParam()
  search?: string;

  @DateParam()
  from?: string;

  @BooleanStringParam()
  flag?: string;
}

const check = (plain: Record<string, unknown>) => {
  const instance = plainToInstance(Sample, plain);
  return { instance, errors: validateSync(instance).map((e) => e.property) };
};

describe('query param decorators', () => {
  it('accepts an empty query', () => {
    expect(check({}).errors).toEqual([]);
  });

  it('trims search and caps its length', () => {
    expect(check({ search: '  kho  ' }).instance.search).toBe('kho');
    expect(check({ search: 'x'.repeat(101) }).errors).toEqual(['search']);
  });

  it('only accepts real calendar days', () => {
    expect(check({ from: '2026-09-01' }).errors).toEqual([]);
    expect(check({ from: '2026-02-30' }).errors).toEqual(['from']);
    expect(check({ from: '2026-09-01T00:00:00Z' }).errors).toEqual(['from']);
  });

  it('only accepts the strings "true"/"false"', () => {
    expect(check({ flag: 'false' }).errors).toEqual([]);
    expect(check({ flag: '1' }).errors).toEqual(['flag']);
  });
});
