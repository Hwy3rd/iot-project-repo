import { ProductUnit } from '../../../libs/constants/product-unit.constant';

// Returned as-is (computed, no entity fields to strip), so there's no
// @Expose()/@Serialize — see GET /cold-rooms/:id/inventory.
export interface ColdRoomInventoryItem {
  productTypeId: string;
  productTypeName: string;
  category: string | null;
  unit: ProductUnit;
  storageTempMin: number | null;
  storageTempMax: number | null;
  batchCount: number;
  totalQuantity: number;
  // YYYY-MM-DD of the batch that expires first.
  nearestExpiry: string;
  expiredBatchCount: number;
  expiringSoonBatchCount: number;
}

export interface ColdRoomInventory {
  coldRoomId: string;
  // YYYY-MM-DD (business timezone) the expired/expiring counts are relative to.
  asOf: string;
  expiringSoonDays: number;
  totalBatches: number;
  // One entry per product type, soonest nearestExpiry first.
  items: ColdRoomInventoryItem[];
}
