import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { MAX_PAGE_LIMIT } from '../../libs/constants/pagination.constant';

// Shared pieces of the `POST /<resource>/bulk-delete` routes.
//
// Best effort, not all-or-nothing: every id goes through the same remove()
// as `DELETE /<resource>/:id` (its own transaction and business rules),
// and one row failing doesn't undo or block the others. The response says
// which ids were deleted and why the rest weren't, so the client can show
// a precise result. Each deleted id gets its own audit entry
// (AuditInterceptor, `@Audit({ bulk: true })`).

export class BulkDeleteDto {
  // Capped like a page, so a request stays bounded; the client splits a
  // larger selection into several calls.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  ids!: string[];
}

export interface BulkDeleteFailure {
  id: string;
  /** HTTP status the single-row DELETE would have answered with. */
  statusCode: number;
  message: string;
}

export interface BulkDeleteResult {
  deleted: string[];
  failed: BulkDeleteFailure[];
}

/**
 * Runs `removeOne` for each id in order and sorts the outcomes. An
 * HttpException (404, 409, 403…) becomes a per-id failure; anything else is
 * a real fault and propagates — rows already deleted stay deleted, like
 * sending the single DELETEs one by one.
 */
export async function bulkDelete(
  ids: readonly string[],
  removeOne: (id: string) => Promise<unknown>,
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deleted: [], failed: [] };
  for (const id of ids) {
    try {
      await removeOne(id);
      result.deleted.push(id);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      result.failed.push({
        id,
        statusCode: error.getStatus(),
        message: error.message,
      });
    }
  }
  return result;
}

/**
 * Per-row warehouse check for bulk routes on warehouse-owned resources —
 * the bulk counterpart of @WarehouseScope on the single DELETE. The route
 * carries @WarehouseListScope (same @Roles / requireShift) so the guard
 * resolves `allowedWarehouseIds` once; `warehouseOf` maps each existing row
 * to its warehouse (null when it has none reachable, e.g. its cold room was
 * deleted — the single route's guard rejects those too).
 */
export function assertInScope(
  id: string,
  warehouseOf: ReadonlyMap<string, string | null>,
  allowedWarehouseIds: readonly string[] | null,
): void {
  if (!warehouseOf.has(id)) throw new NotFoundException(`${id} not found`);
  if (allowedWarehouseIds === null) return; // Admin
  const warehouseId = warehouseOf.get(id);
  if (!warehouseId || !allowedWarehouseIds.includes(warehouseId)) {
    throw new ForbiddenException(
      'Not allowed to act on resources of this warehouse',
    );
  }
}
