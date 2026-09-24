import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../../libs/constants/pagination.constant';
import type { PaginationQueryDto } from './pagination-query.dto';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ResolvedPagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export const resolvePagination = (
  query: PaginationQueryDto = {},
): ResolvedPagination => {
  const page = Math.max(query.page ?? DEFAULT_PAGE, 1);
  const limit = Math.min(
    Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1),
    MAX_PAGE_LIMIT,
  );
  return { page, limit, skip: (page - 1) * limit, take: limit };
};

// A class (not a plain interface) so TransformInterceptor can recognise it
// with instanceof and apply @Serialize's DTO to `items` only — serializing
// the wrapper itself would strip both fields, since neither is @Expose()d.
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}

  static of<T>(
    items: T[],
    total: number,
    { page, limit }: Pick<ResolvedPagination, 'page' | 'limit'>,
  ): Paginated<T> {
    return new Paginated(items, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }

  static empty<T>(query?: PaginationQueryDto): Paginated<T> {
    return Paginated.of<T>([], 0, resolvePagination(query));
  }

  map<U>(fn: (item: T) => U): Paginated<U> {
    return new Paginated(this.items.map(fn), this.meta);
  }
}
