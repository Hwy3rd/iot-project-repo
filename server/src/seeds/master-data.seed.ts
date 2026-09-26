import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { EntityManager, IsNull, Like, Not } from 'typeorm';
import AppDataSource from '../database/data-source';
import {
  CHANNEL_TYPE_ROLE,
  ChannelType,
} from '../libs/constants/device-channel.constant';
import { BatchStatus } from '../libs/constants/batch.constant';
import { DeviceStatus } from '../libs/constants/device.constant';
import { ProductUnit } from '../libs/constants/product-unit.constant';
import { UserRole, UserStatus } from '../libs/constants/user.constant';
import { Batch } from '../modules/batches/entities/batch.entity';
import { ColdRoom } from '../modules/cold-rooms/entities/cold-room.entity';
import { DeviceChannel } from '../modules/device-channels/entities/device-channel.entity';
import { Device } from '../modules/devices/entities/device.entity';
import { ProductType } from '../modules/product-types/entities/product-type.entity';
import { Shift } from '../modules/shifts/entities/shift.entity';
import { User } from '../modules/users/entities/user.entity';
import { WarehouseStaff } from '../modules/warehouses/entities/warehouse-staff.entity';
import { Warehouse } from '../modules/warehouses/entities/warehouse.entity';

// Demo data for a Hanoi cold-chain operator storing mostly food: users,
// warehouses (+ staff assignments), product types, cold rooms, shift
// templates, devices (+ channels) and batches of stock in every room.
// Other transactional tables (work shifts, commands, alerts…) are left empty.
//
// Idempotent: every row is looked up by its natural key (username, warehouse
// code, product type name, warehouse+room name, shift name, device unique id,
// room+batch code) and only created when missing — existing rows are never
// modified, so it's safe to re-run and won't clobber edits made through the
// app. Batch dates are relative to the day the batch is first seeded.
//
// `--reset` first wipes the MySQL data: every table except `migrations` is
// truncated, and of the users only the demo accounts (@coldchain.local) are
// deleted — accounts from seed:admin are kept and assigned to every seeded
// warehouse, since the wipe removed their assignments. MongoDB telemetry is
// not touched. Dev and prod share one database here, so this wipes both.
//
// Usage: `pnpm run seed:master [-- --reset]` with SEED_DEMO_PASSWORD set
// (the password for every seeded account — never hardcode one here).

const SALT_ROUNDS = 10; // Same as UsersService.create().
const DEMO_EMAIL_DOMAIN = 'coldchain.local';

const WAREHOUSES = [
  {
    code: 'WH-HN-01',
    name: 'Kho lạnh Long Biên',
    address: '156 Nguyễn Văn Cừ, P. Bồ Đề, Q. Long Biên, Hà Nội',
  },
  {
    code: 'WH-HN-02',
    name: 'Kho lạnh Hoàng Mai',
    address: '9 Tam Trinh, P. Mai Động, Q. Hoàng Mai, Hà Nội',
  },
  {
    code: 'WH-HN-03',
    name: 'Kho lạnh Bắc Thăng Long',
    address: 'KCN Bắc Thăng Long, H. Đông Anh, Hà Nội',
  },
];

// Storage ranges are chosen so each product fits at least one room profile
// below (BatchesService rejects a batch whose room range isn't inside the
// product's range). `shelfDays` is a typical shelf life, used to date the
// seeded batches; `supplier` is who the seeded batches come from.
const PRODUCT_TYPES: {
  name: string;
  category: string;
  unit: ProductUnit;
  min: number;
  max: number;
  shelfDays: number;
  supplier: string;
}[] = [
  // Frozen meat and ready meals
  {
    name: 'Thịt bò đông lạnh',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -25,
    max: -15,
    shelfDays: 365,
    supplier: 'Công ty CP Vissan',
  },
  {
    name: 'Thịt heo đông lạnh',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -25,
    max: -15,
    shelfDays: 270,
    supplier: 'Masan MEATLife',
  },
  {
    name: 'Thịt gà đông lạnh',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -25,
    max: -15,
    shelfDays: 270,
    supplier: 'C.P. Việt Nam',
  },
  {
    name: 'Xúc xích đông lạnh',
    category: 'Thực phẩm chế biến',
    unit: ProductUnit.BOX,
    min: -25,
    max: -15,
    shelfDays: 180,
    supplier: 'Đức Việt Food',
  },
  {
    name: 'Chả giò đông lạnh',
    category: 'Thực phẩm chế biến',
    unit: ProductUnit.BOX,
    min: -25,
    max: -15,
    shelfDays: 180,
    supplier: 'Cầu Tre',
  },
  {
    name: 'Há cảo đông lạnh',
    category: 'Thực phẩm chế biến',
    unit: ProductUnit.BOX,
    min: -25,
    max: -15,
    shelfDays: 180,
    supplier: 'Vissan',
  },
  // Frozen seafood and ice cream (fit both frozen and deep-frozen rooms)
  {
    name: 'Tôm sú đông lạnh',
    category: 'Thuỷ sản',
    unit: ProductUnit.BOX,
    min: -30,
    max: -18,
    shelfDays: 365,
    supplier: 'Thuỷ sản Minh Phú',
  },
  {
    name: 'Cá basa phi lê đông lạnh',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -30,
    max: -18,
    shelfDays: 365,
    supplier: 'Vĩnh Hoàn',
  },
  {
    name: 'Mực ống đông lạnh',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -30,
    max: -18,
    shelfDays: 300,
    supplier: 'Hạ Long Canfoco',
  },
  {
    name: 'Cá thu cắt khúc đông lạnh',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -30,
    max: -18,
    shelfDays: 270,
    supplier: 'Hạ Long Canfoco',
  },
  {
    name: 'Kem hộp',
    category: 'Kem',
    unit: ProductUnit.BOX,
    min: -30,
    max: -18,
    shelfDays: 365,
    supplier: 'Kido Foods (Merino)',
  },
  // Chilled
  {
    name: 'Thịt bò tươi',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -1,
    max: 4,
    shelfDays: 10,
    supplier: 'Công ty CP Vissan',
  },
  {
    name: 'Thịt heo tươi',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -1,
    max: 4,
    shelfDays: 5,
    supplier: 'Masan MEATLife',
  },
  {
    name: 'Cá hồi phi lê tươi',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -2,
    max: 4,
    shelfDays: 6,
    supplier: 'Hải sản Sa Pa',
  },
  {
    name: 'Sữa tươi thanh trùng',
    category: 'Sữa',
    unit: ProductUnit.LITER,
    min: 0,
    max: 6,
    shelfDays: 10,
    supplier: 'TH True Milk',
  },
  {
    name: 'Sữa chua',
    category: 'Sữa',
    unit: ProductUnit.BOX,
    min: 0,
    max: 6,
    shelfDays: 30,
    supplier: 'Vinamilk',
  },
  {
    name: 'Phô mai',
    category: 'Sữa',
    unit: ProductUnit.KG,
    min: 0,
    max: 8,
    shelfDays: 120,
    supplier: 'Vinamilk',
  },
  {
    name: 'Đậu phụ',
    category: 'Thực phẩm chế biến',
    unit: ProductUnit.BOX,
    min: 0,
    max: 6,
    shelfDays: 5,
    supplier: 'Đậu phụ Mơ',
  },
  // Cool (produce, eggs)
  {
    name: 'Rau ăn lá',
    category: 'Rau củ',
    unit: ProductUnit.KG,
    min: 1,
    max: 8,
    shelfDays: 5,
    supplier: 'HTX rau an toàn Văn Đức',
  },
  {
    name: 'Nấm tươi',
    category: 'Rau củ',
    unit: ProductUnit.KG,
    min: 1,
    max: 6,
    shelfDays: 7,
    supplier: 'Nấm Đông Anh',
  },
  {
    name: 'Trái cây tươi',
    category: 'Trái cây',
    unit: ProductUnit.KG,
    min: 2,
    max: 12,
    shelfDays: 14,
    supplier: 'Klever Fruits',
  },
  {
    name: 'Trứng gà',
    category: 'Trứng',
    unit: ProductUnit.PIECE,
    min: 2,
    max: 10,
    shelfDays: 30,
    supplier: 'Trứng Ba Huân',
  },
];

const ROOM_PROFILES = {
  frozen: { tempMin: -22, tempMax: -18, hysteresis: 1 },
  deepFrozen: { tempMin: -28, tempMax: -22, hysteresis: 1 },
  chill: { tempMin: 0, tempMax: 4, hysteresis: 0.5 },
  cool: { tempMin: 2, tempMax: 6, hysteresis: 0.5 },
} as const;

// 11 rooms; `wh` indexes WAREHOUSES, `code` prefixes the room's batch codes.
const COLD_ROOMS: {
  wh: number;
  code: string;
  name: string;
  profile: keyof typeof ROOM_PROFILES;
  pallets: number;
  /** Product categories the room is used for; omitted = anything that fits. */
  categories?: string[];
}[] = [
  {
    wh: 0,
    code: 'LB-A1',
    name: 'Phòng A1 – Cấp đông thịt',
    profile: 'frozen',
    pallets: 140,
    categories: ['Thịt', 'Thực phẩm chế biến'],
  },
  {
    wh: 0,
    code: 'LB-A2',
    name: 'Phòng A2 – Đông sâu thuỷ sản',
    profile: 'deepFrozen',
    pallets: 100,
    categories: ['Thuỷ sản'],
  },
  {
    wh: 0,
    code: 'LB-A3',
    name: 'Phòng A3 – Mát thịt & sữa',
    profile: 'chill',
    pallets: 80,
    categories: ['Thịt', 'Thuỷ sản', 'Sữa'],
  },
  {
    wh: 0,
    code: 'LB-A4',
    name: 'Phòng A4 – Rau quả',
    profile: 'cool',
    pallets: 60,
    categories: ['Rau củ', 'Trái cây'],
  },
  {
    wh: 1,
    code: 'HM-B1',
    name: 'Phòng B1 – Cấp đông',
    profile: 'frozen',
    pallets: 120,
  },
  {
    wh: 1,
    code: 'HM-B2',
    name: 'Phòng B2 – Đông sâu kem',
    profile: 'deepFrozen',
    pallets: 60,
    categories: ['Kem'],
  },
  {
    wh: 1,
    code: 'HM-B3',
    name: 'Phòng B3 – Mát sữa',
    profile: 'chill',
    pallets: 70,
    categories: ['Sữa', 'Thực phẩm chế biến'],
  },
  {
    wh: 1,
    code: 'HM-B4',
    name: 'Phòng B4 – Rau quả & trứng',
    profile: 'cool',
    pallets: 50,
    categories: ['Rau củ', 'Trái cây', 'Trứng'],
  },
  {
    wh: 2,
    code: 'TL-C1',
    name: 'Phòng C1 – Cấp đông',
    profile: 'frozen',
    pallets: 160,
  },
  {
    wh: 2,
    code: 'TL-C2',
    name: 'Phòng C2 – Đông sâu thuỷ sản',
    profile: 'deepFrozen',
    pallets: 120,
    categories: ['Thuỷ sản'],
  },
  {
    wh: 2,
    code: 'TL-C3',
    name: 'Phòng C3 – Mát',
    profile: 'chill',
    pallets: 90,
  },
];

// `warehouses` indexes WAREHOUSES; the user works in each with their account
// role (a Manager manages, Staff works shifts, a Technician services devices).
const USERS: {
  username: string;
  fullName: string;
  role: UserRole;
  warehouses: number[];
}[] = [
  {
    username: 'manager.hn',
    fullName: 'Trần Thị Bình',
    role: UserRole.MANAGER,
    warehouses: [0, 1],
  },
  {
    username: 'manager.dongan',
    fullName: 'Lê Hoàng Cường',
    role: UserRole.MANAGER,
    warehouses: [2],
  },
  {
    username: 'staff.longbien',
    fullName: 'Đỗ Văn Khánh',
    role: UserRole.STAFF,
    warehouses: [0],
  },
  {
    username: 'staff.hoangmai',
    fullName: 'Ngô Thị Lan',
    role: UserRole.STAFF,
    warehouses: [1],
  },
  {
    username: 'staff.dongan',
    fullName: 'Phạm Minh Dũng',
    role: UserRole.STAFF,
    warehouses: [2],
  },
  {
    username: 'staff.hn',
    fullName: 'Vũ Thu Hà',
    role: UserRole.STAFF,
    warehouses: [0, 1],
  },
  {
    username: 'tech.hn',
    fullName: 'Kiều Văn Sơn',
    role: UserRole.TECHNICIAN,
    warehouses: [0, 1, 2],
  },
];

// Back to back, never overlapping (ShiftsService refuses overlaps).
const SHIFTS = [
  { name: 'Ca sáng', startTime: '06:00:00', endTime: '14:00:00' },
  { name: 'Ca chiều', startTime: '14:00:00', endTime: '22:00:00' },
  { name: 'Ca tối', startTime: '22:00:00', endTime: '06:00:00' },
];

// The peripherals wired to one installed ESP32.
const STANDARD_CHANNELS: { type: ChannelType; label: string }[] = [
  { type: ChannelType.TEMP_HUMIDITY_SENSOR, label: 'Cảm biến nhiệt ẩm' },
  { type: ChannelType.LIMIT_SWITCH, label: 'Công tắc cửa' },
  { type: ChannelType.CURRENT_SENSOR, label: 'Dòng máy nén' },
  { type: ChannelType.FAN_MOTOR, label: 'Quạt dàn lạnh' },
  { type: ChannelType.INDICATOR_LIGHT, label: 'Đèn báo' },
  { type: ChannelType.BUZZER, label: 'Còi báo động' },
];

// One installed per room + 2 provisioned + 1 registered, i.e. ready to be
// claimed / not yet flashed.
const INSTALLED_DEVICES = COLD_ROOMS.length;
const DEVICE_COUNT = INSTALLED_DEVICES + 3;

// Quantity range per unit for one batch.
const QUANTITY: Record<ProductUnit, [number, number]> = {
  [ProductUnit.KG]: [150, 1500],
  [ProductUnit.BOX]: [40, 400],
  [ProductUnit.LITER]: [200, 1200],
  [ProductUnit.PIECE]: [1800, 9000],
};

const fits = (
  room: (typeof ROOM_PROFILES)[keyof typeof ROOM_PROFILES],
  p: (typeof PRODUCT_TYPES)[number],
) => room.tempMin >= p.min && room.tempMax <= p.max;

// YYYY-MM-DD in the business timezone (fixed UTC+7), `offsetDays` from today.
const DAY_MS = 24 * 60 * 60 * 1000;
const businessDay = (offsetDays: number) =>
  new Date(Date.now() + 7 * 60 * 60 * 1000 + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

// Deterministic 0..1 values, so a re-seed produces the same batches.
const pseudoRandom = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// 4–8 batches per room from the products that fit it. Per room: batch #2
// expires within a few days (demo "sắp hết hạn"); every third room also has
// one already past its expiry date, and every fourth one a batch taken out.
function batchesFor(roomIndex: number) {
  const room = COLD_ROOMS[roomIndex];
  const products = PRODUCT_TYPES.filter(
    (p) =>
      fits(ROOM_PROFILES[room.profile], p) &&
      (!room.categories || room.categories.includes(p.category)),
  );
  const count = 4 + (roomIndex % 5);
  return Array.from({ length: count }, (_, j) => {
    const product = products[(roomIndex * 3 + j) % products.length];
    const r = pseudoRandom(roomIndex * 31 + j + 1);
    let expiryOffset: number;
    if (j === 1) expiryOffset = 2 + Math.floor(r * 5);
    else if (j === 2 && roomIndex % 3 === 0)
      expiryOffset = -(1 + Math.floor(r * 4));
    else
      expiryOffset = Math.max(
        1,
        Math.round(product.shelfDays * (0.3 + r * 0.6)),
      );
    // Received one shelf life before expiry, but at least yesterday.
    const receivedOffset = Math.min(
      -1 - (j % 5),
      expiryOffset - product.shelfDays,
    );
    const [lo, hi] = QUANTITY[product.unit];
    const removed = j === count - 1 && roomIndex % 4 === 1;
    return {
      batchCode: `${room.code}-${String(j + 1).padStart(3, '0')}`,
      product,
      quantity: Math.round(lo + r * (hi - lo)),
      receivedAt: businessDay(receivedOffset),
      expiryDate: businessDay(expiryOffset),
      removedAt: removed ? businessDay(Math.min(-1, receivedOffset + 3)) : null,
    };
  });
}

interface Counts {
  created: number;
  existing: number;
}

async function findOrCreate<T extends object>(
  manager: EntityManager,
  entity: new () => T,
  where: Partial<T>,
  build: () => Partial<T>,
  counts: Counts,
): Promise<T> {
  const repo = manager.getRepository(entity);
  const found = await repo.findOne({ where: where as never });
  if (found) {
    counts.existing++;
    return found;
  }
  counts.created++;
  return repo.save(repo.create({ ...where, ...build() } as T));
}

// Wipes the MySQL data (see the header comment). TRUNCATE commits on its
// own in MySQL, so this runs before — not inside — the seeding transaction,
// on one connection so FOREIGN_KEY_CHECKS=0 applies to every statement.
async function resetData(): Promise<void> {
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();
  try {
    const tables = (await runner.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
         AND table_name NOT IN ('migrations', 'users')`,
    )) as { name: string }[];
    await runner.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const { name } of tables) {
        await runner.query(`TRUNCATE TABLE \`${name}\``);
      }
      await runner.query('DELETE FROM `users` WHERE `email` LIKE ?', [
        `%@${DEMO_EMAIL_DOMAIN}`,
      ]);
    } finally {
      await runner.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    console.log(
      `Reset: truncated ${tables.length} tables, removed demo accounts.`,
    );
  } finally {
    await runner.release();
  }
}

async function seedMasterData(): Promise<void> {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_DEMO_PASSWORD is required — the password given to every seeded demo account.',
    );
  }

  const reset = process.argv.includes('--reset');

  await AppDataSource.initialize();
  try {
    if (reset) await resetData();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const tally: Record<string, Counts> = {};
    const counter = (table: string) =>
      (tally[table] ??= { created: 0, existing: 0 });

    // One transaction: a failure halfway leaves nothing behind.
    await AppDataSource.transaction(async (m) => {
      const warehouses: Warehouse[] = [];
      for (const w of WAREHOUSES) {
        warehouses.push(
          await findOrCreate(
            m,
            Warehouse,
            { code: w.code },
            () => ({
              name: w.name,
              address: w.address,
            }),
            counter('warehouses'),
          ),
        );
      }

      const productTypes = new Map<string, ProductType>();
      for (const p of PRODUCT_TYPES) {
        const productType = await findOrCreate(
          m,
          ProductType,
          { name: p.name },
          () => ({
            category: p.category,
            unit: p.unit,
            storageTempMin: p.min,
            storageTempMax: p.max,
          }),
          counter('product_types'),
        );
        productTypes.set(p.name, productType);
      }

      const rooms: ColdRoom[] = [];
      for (const r of COLD_ROOMS) {
        const profile = ROOM_PROFILES[r.profile];
        rooms.push(
          await findOrCreate(
            m,
            ColdRoom,
            { warehouseId: warehouses[r.wh].id, name: r.name },
            () => ({
              ...profile,
              doorOpenMaxSeconds: r.profile === 'cool' ? 30 : 15,
              capacityPallets: r.pallets,
              capacityWeightKg: r.pallets * 800,
              capacityVolumeM3: Math.round(r.pallets * 1.8),
            }),
            counter('cold_rooms'),
          ),
        );
      }

      for (const s of SHIFTS) {
        await findOrCreate(
          m,
          Shift,
          { name: s.name },
          () => ({
            startTime: s.startTime,
            endTime: s.endTime,
          }),
          counter('shifts'),
        );
      }

      for (const u of USERS) {
        const user = await findOrCreate(
          m,
          User,
          { username: u.username },
          () => ({
            fullName: u.fullName,
            email: `${u.username}@${DEMO_EMAIL_DOMAIN}`,
            passwordHash,
            role: u.role,
            status: UserStatus.ACTIVE,
          }),
          counter('users'),
        );
        for (const wh of u.warehouses) {
          await findOrCreate(
            m,
            WarehouseStaff,
            { userId: user.id, warehouseId: warehouses[wh].id },
            () => ({}),
            counter('warehouse_staff'),
          );
        }
      }

      // The wipe dropped the seed:admin accounts' assignments; give them
      // every warehouse so they see the demo data right away.
      if (reset) {
        const kept = await m.getRepository(User).find({
          // NOT LIKE is never true for a NULL email, hence the two branches.
          where: [
            { role: Not(UserRole.ADMIN), email: IsNull() },
            {
              role: Not(UserRole.ADMIN),
              email: Not(Like(`%@${DEMO_EMAIL_DOMAIN}`)),
            },
          ],
        });
        for (const user of kept) {
          for (const warehouse of warehouses) {
            await findOrCreate(
              m,
              WarehouseStaff,
              { userId: user.id, warehouseId: warehouse.id },
              () => ({}),
              counter('warehouse_staff'),
            );
          }
        }
      }

      for (const [i, room] of rooms.entries()) {
        for (const b of batchesFor(i)) {
          await findOrCreate(
            m,
            Batch,
            { coldRoomId: room.id, batchCode: b.batchCode },
            () => ({
              productTypeId: productTypes.get(b.product.name)!.id,
              quantity: b.quantity,
              supplier: b.product.supplier,
              receivedAt: b.receivedAt,
              expiryDate: b.expiryDate,
              removedAt: b.removedAt,
              status: b.removedAt ? BatchStatus.REMOVED : BatchStatus.IN_STOCK,
            }),
            counter('batches'),
          );
        }
      }

      for (let i = 0; i < DEVICE_COUNT; i++) {
        const uniqueId = `ESP32-${(0xa10000 + i * 0x1f3).toString(16).toUpperCase()}`;
        const installed = i < INSTALLED_DEVICES;
        const counts = counter('devices');
        const before = counts.created;
        const device = await findOrCreate(
          m,
          Device,
          { uniqueId },
          () => {
            if (installed) {
              return {
                coldRoomId: rooms[i].id,
                firmwareVersion: i % 3 === 0 ? '1.2.0' : '1.3.1',
                status: DeviceStatus.ACTIVE,
                claimedAt: new Date(),
              };
            }
            return {
              firmwareVersion: i < INSTALLED_DEVICES + 2 ? '1.3.1' : null,
              status:
                i < INSTALLED_DEVICES + 2
                  ? DeviceStatus.PROVISIONED
                  : DeviceStatus.REGISTERED,
            };
          },
          counts,
        );
        // Channels are only added alongside a freshly created installed
        // device, so a re-run never duplicates them.
        if (installed && counts.created > before) {
          for (const c of STANDARD_CHANNELS) {
            await m.getRepository(DeviceChannel).save(
              m.getRepository(DeviceChannel).create({
                deviceId: device.id,
                channelType: c.type,
                channelRole: CHANNEL_TYPE_ROLE[c.type],
                label: c.label,
              }),
            );
            counter('device_channels').created++;
          }
        }
      }
    });

    console.table(tally);
  } finally {
    await AppDataSource.destroy();
  }
}

seedMasterData().catch((error: unknown) => {
  console.error('Seeding master data failed:', error);
  process.exitCode = 1;
});
