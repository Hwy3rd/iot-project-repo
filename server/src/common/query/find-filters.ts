import {
  And,
  Equal,
  FindOperator,
  FindOptionsWhere,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
} from 'typeorm';

const DAY_MS = 24 * 60 * 60 * 1000;

// MySQL's default LIKE escape character is the backslash.
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

// Case-insensitive under the tables' default MySQL collation.
export const containsLike = (value: string) => Like(`%${escapeLike(value)}%`);

const andWith = <V>(existing: unknown, operator: FindOperator<V>) =>
  existing === undefined
    ? operator
    : And(
        existing instanceof FindOperator
          ? (existing as FindOperator<V>)
          : Equal(existing as V),
        operator,
      );

// `search` matches when any of `fields` contains it: one OR branch per field
// (TypeORM ORs the elements of a where array), each carrying all of `base`.
// A field `base` already constrains keeps that constraint, ANDed with LIKE.
export const withSearch = <T>(
  base: FindOptionsWhere<T>,
  search: string | undefined,
  fields: readonly (keyof T & string)[],
): FindOptionsWhere<T> | FindOptionsWhere<T>[] => {
  if (!search) return base;
  const pattern = containsLike(search);
  return fields.map(
    (field) =>
      ({
        ...base,
        [field]: andWith((base as Record<string, unknown>)[field], pattern),
      }) as FindOptionsWhere<T>,
  );
};

// For timestamp columns: YYYY-MM-DD bounds, both inclusive, as UTC days
// (the connection runs with timezone 'Z').
export const createdBetween = (
  from?: string,
  to?: string,
): FindOperator<Date> | undefined => {
  const start = from ? new Date(`${from}T00:00:00Z`) : undefined;
  const end = to
    ? new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY_MS)
    : undefined;
  if (start && end) return And(MoreThanOrEqual(start), LessThan(end));
  if (start) return MoreThanOrEqual(start);
  if (end) return LessThan(end);
  return undefined;
};

// For DATE columns (mapped to YYYY-MM-DD strings): both bounds inclusive.
export const dayBetween = (
  from?: string,
  to?: string,
): FindOperator<string> | undefined => {
  if (from && to) return And(MoreThanOrEqual(from), LessThanOrEqual(to));
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
};

// Intersects the caller's warehouse scope (WarehouseAccess.warehouseIds,
// null/undefined = unrestricted) with an explicit `?warehouseId=` filter.
// undefined = no restriction; [] = nothing can match.
export const narrowWarehouseIds = (
  scope: string[] | null | undefined,
  warehouseId?: string,
): string[] | undefined => {
  if (!warehouseId) return scope ?? undefined;
  if (scope && !scope.includes(warehouseId)) return [];
  return [warehouseId];
};
