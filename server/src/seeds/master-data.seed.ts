import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { EntityManager } from 'typeorm';
import AppDataSource from '../database/data-source';
import {
  CHANNEL_TYPE_ROLE,
  ChannelType,
} from '../libs/constants/device-channel.constant';
import { DeviceStatus } from '../libs/constants/device.constant';
import { ProductUnit } from '../libs/constants/product-unit.constant';
import { UserRole, UserStatus } from '../libs/constants/user.constant';
import { ColdRoom } from '../modules/cold-rooms/entities/cold-room.entity';
import { DeviceChannel } from '../modules/device-channels/entities/device-channel.entity';
import { Device } from '../modules/devices/entities/device.entity';
import { ProductType } from '../modules/product-types/entities/product-type.entity';
import { Shift } from '../modules/shifts/entities/shift.entity';
import { User } from '../modules/users/entities/user.entity';
import { WarehouseStaff } from '../modules/warehouses/entities/warehouse-staff.entity';
import { Warehouse } from '../modules/warehouses/entities/warehouse.entity';

// Demo master data: users, warehouses (+ staff assignments), product types,
// cold rooms, shift templates, devices (+ channels). Transactional tables
// (batches, work shifts, commands, alerts…) are left alone.
//
// Idempotent: every row is looked up by its natural key (username, warehouse
// code, product type name, warehouse+room name, shift name, device unique id)
// and only created when missing — existing rows are never modified, so it's
// safe to re-run and won't clobber edits made through the app.
//
// Usage: `pnpm run seed:master` with SEED_DEMO_PASSWORD set (the password for
// every seeded account — never hardcode one here).

const SALT_ROUNDS = 10; // Same as UsersService.create().

const WAREHOUSES = [
  {
    code: 'WH-HCM-01',
    name: 'Kho lạnh Tân Bình',
    address: '12 Cộng Hoà, P.4, Q. Tân Bình, TP.HCM',
  },
  {
    code: 'WH-HCM-02',
    name: 'Kho lạnh Thủ Đức',
    address: '88 Xa lộ Hà Nội, TP. Thủ Đức, TP.HCM',
  },
  {
    code: 'WH-HCM-03',
    name: 'Kho lạnh Bình Chánh',
    address: 'KCN Lê Minh Xuân, H. Bình Chánh, TP.HCM',
  },
  {
    code: 'WH-HCM-04',
    name: 'Kho lạnh Quận 7',
    address: '25 Nguyễn Văn Linh, Q.7, TP.HCM',
  },
  {
    code: 'WH-HN-01',
    name: 'Kho lạnh Long Biên',
    address: '156 Nguyễn Văn Cừ, Q. Long Biên, Hà Nội',
  },
  {
    code: 'WH-HN-02',
    name: 'Kho lạnh Hoàng Mai',
    address: '9 Tam Trinh, Q. Hoàng Mai, Hà Nội',
  },
  {
    code: 'WH-HN-03',
    name: 'Kho lạnh Bắc Thăng Long',
    address: 'KCN Bắc Thăng Long, H. Đông Anh, Hà Nội',
  },
  {
    code: 'WH-DN-01',
    name: 'Kho lạnh Liên Chiểu',
    address: 'KCN Hoà Khánh, Q. Liên Chiểu, Đà Nẵng',
  },
  {
    code: 'WH-DN-02',
    name: 'Kho lạnh Sơn Trà',
    address: 'Cảng cá Thọ Quang, Q. Sơn Trà, Đà Nẵng',
  },
  {
    code: 'WH-CT-01',
    name: 'Kho lạnh Cần Thơ',
    address: 'KCN Trà Nóc 1, Q. Bình Thuỷ, Cần Thơ',
  },
  {
    code: 'WH-HP-01',
    name: 'Kho lạnh Hải Phòng',
    address: 'KCN Đình Vũ, Q. Hải An, Hải Phòng',
  },
  {
    code: 'WH-BD-01',
    name: 'Kho lạnh Bình Dương',
    address: 'KCN VSIP 1, TP. Thuận An, Bình Dương',
  },
  {
    code: 'WH-DNA-01',
    name: 'Kho lạnh Biên Hoà',
    address: 'KCN Amata, TP. Biên Hoà, Đồng Nai',
  },
  {
    code: 'WH-KH-01',
    name: 'Kho lạnh Nha Trang',
    address: 'Cảng Hòn Rớ, TP. Nha Trang, Khánh Hoà',
  },
  { code: 'WH-LA-01', name: 'Kho lạnh Long An', address: null },
];

// Storage ranges are chosen so each product fits at least one room profile
// below (BatchesService rejects a batch whose room range isn't inside the
// product's range).
const PRODUCT_TYPES = [
  {
    name: 'Thịt bò đông lạnh',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -25,
    max: -15,
  },
  {
    name: 'Thịt heo đông lạnh',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -25,
    max: -15,
  },
  {
    name: 'Thịt gà đông lạnh',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -25,
    max: -15,
  },
  {
    name: 'Thịt bò tươi',
    category: 'Thịt',
    unit: ProductUnit.KG,
    min: -1,
    max: 4,
  },
  {
    name: 'Tôm sú đông lạnh',
    category: 'Thuỷ sản',
    unit: ProductUnit.BOX,
    min: -25,
    max: -18,
  },
  {
    name: 'Cá basa phi lê',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -25,
    max: -18,
  },
  {
    name: 'Mực ống đông lạnh',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -25,
    max: -18,
  },
  {
    name: 'Cá hồi tươi',
    category: 'Thuỷ sản',
    unit: ProductUnit.KG,
    min: -2,
    max: 4,
  },
  {
    name: 'Sữa tươi tiệt trùng',
    category: 'Sữa',
    unit: ProductUnit.LITER,
    min: 0,
    max: 6,
  },
  { name: 'Sữa chua', category: 'Sữa', unit: ProductUnit.BOX, min: 0, max: 6 },
  { name: 'Phô mai', category: 'Sữa', unit: ProductUnit.KG, min: 0, max: 8 },
  {
    name: 'Kem',
    category: 'Đồ ngọt',
    unit: ProductUnit.BOX,
    min: -30,
    max: -18,
  },
  {
    name: 'Rau xanh',
    category: 'Rau củ',
    unit: ProductUnit.KG,
    min: 1,
    max: 8,
  },
  {
    name: 'Trái cây nhiệt đới',
    category: 'Rau củ',
    unit: ProductUnit.KG,
    min: 2,
    max: 12,
  },
  {
    name: 'Nấm tươi',
    category: 'Rau củ',
    unit: ProductUnit.KG,
    min: 1,
    max: 6,
  },
  {
    name: 'Trứng gà',
    category: 'Trứng',
    unit: ProductUnit.PIECE,
    min: 2,
    max: 10,
  },
  {
    name: 'Vắc-xin',
    category: 'Dược phẩm',
    unit: ProductUnit.BOX,
    min: 2,
    max: 8,
  },
  {
    name: 'Insulin',
    category: 'Dược phẩm',
    unit: ProductUnit.BOX,
    min: 2,
    max: 8,
  },
  {
    name: 'Nước giải khát',
    category: 'Đồ uống',
    unit: ProductUnit.LITER,
    min: null,
    max: null,
  },
  {
    name: 'Hoa tươi',
    category: 'Khác',
    unit: ProductUnit.PIECE,
    min: 2,
    max: 8,
  },
];

const ROOM_PROFILES = {
  frozen: { tempMin: -22, tempMax: -18, hysteresis: 1 },
  deepFrozen: { tempMin: -28, tempMax: -22, hysteresis: 1 },
  chill: { tempMin: 0, tempMax: 4, hysteresis: 0.5 },
  cool: { tempMin: 2, tempMax: 6, hysteresis: 0.5 },
} as const;

// 20 rooms; `wh` indexes WAREHOUSES.
const COLD_ROOMS: {
  wh: number;
  name: string;
  profile: keyof typeof ROOM_PROFILES;
  pallets: number;
}[] = [
  { wh: 0, name: 'Phòng A1 – Cấp đông', profile: 'frozen', pallets: 120 },
  { wh: 0, name: 'Phòng A2 – Mát', profile: 'chill', pallets: 80 },
  { wh: 0, name: 'Phòng A3 – Dược phẩm', profile: 'cool', pallets: 30 },
  { wh: 1, name: 'Phòng B1 – Cấp đông', profile: 'frozen', pallets: 150 },
  { wh: 1, name: 'Phòng B2 – Mát', profile: 'cool', pallets: 90 },
  { wh: 2, name: 'Phòng C1 – Đông sâu', profile: 'deepFrozen', pallets: 60 },
  { wh: 3, name: 'Phòng D1 – Mát', profile: 'chill', pallets: 70 },
  { wh: 4, name: 'Phòng E1 – Cấp đông', profile: 'frozen', pallets: 140 },
  { wh: 4, name: 'Phòng E2 – Mát', profile: 'cool', pallets: 60 },
  { wh: 5, name: 'Phòng F1 – Mát', profile: 'chill', pallets: 50 },
  { wh: 6, name: 'Phòng G1 – Đông sâu', profile: 'deepFrozen', pallets: 100 },
  { wh: 7, name: 'Phòng H1 – Cấp đông', profile: 'frozen', pallets: 90 },
  { wh: 8, name: 'Phòng I1 – Thuỷ sản', profile: 'deepFrozen', pallets: 110 },
  { wh: 8, name: 'Phòng I2 – Mát', profile: 'chill', pallets: 40 },
  { wh: 9, name: 'Phòng K1 – Cấp đông', profile: 'frozen', pallets: 130 },
  { wh: 10, name: 'Phòng L1 – Cấp đông', profile: 'frozen', pallets: 160 },
  { wh: 11, name: 'Phòng M1 – Mát', profile: 'cool', pallets: 75 },
  { wh: 12, name: 'Phòng N1 – Mát', profile: 'chill', pallets: 65 },
  { wh: 13, name: 'Phòng O1 – Thuỷ sản', profile: 'deepFrozen', pallets: 120 },
  { wh: 14, name: 'Phòng P1 – Mát', profile: 'cool', pallets: 45 },
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
    username: 'manager.hcm',
    fullName: 'Nguyễn Văn An',
    role: UserRole.MANAGER,
    warehouses: [0, 1, 2, 3],
  },
  {
    username: 'manager.hn',
    fullName: 'Trần Thị Bình',
    role: UserRole.MANAGER,
    warehouses: [4, 5, 6],
  },
  {
    username: 'manager.dn',
    fullName: 'Lê Hoàng Cường',
    role: UserRole.MANAGER,
    warehouses: [7, 8, 13],
  },
  {
    username: 'manager.south',
    fullName: 'Phạm Minh Dũng',
    role: UserRole.MANAGER,
    warehouses: [9, 11, 12, 14],
  },
  {
    username: 'manager.hp',
    fullName: 'Hoàng Thu Hà',
    role: UserRole.MANAGER,
    warehouses: [10],
  },
  {
    username: 'staff.tanbinh',
    fullName: 'Võ Thị Hồng',
    role: UserRole.STAFF,
    warehouses: [0],
  },
  {
    username: 'staff.thuduc',
    fullName: 'Đặng Quốc Huy',
    role: UserRole.STAFF,
    warehouses: [1],
  },
  {
    username: 'staff.binhchanh',
    fullName: 'Bùi Thanh Hương',
    role: UserRole.STAFF,
    warehouses: [2, 3],
  },
  {
    username: 'staff.longbien',
    fullName: 'Đỗ Văn Khánh',
    role: UserRole.STAFF,
    warehouses: [4],
  },
  {
    username: 'staff.hoangmai',
    fullName: 'Ngô Thị Lan',
    role: UserRole.STAFF,
    warehouses: [5, 6],
  },
  {
    username: 'staff.danang',
    fullName: 'Dương Văn Long',
    role: UserRole.STAFF,
    warehouses: [7, 8],
  },
  {
    username: 'staff.cantho',
    fullName: 'Lý Thị Mai',
    role: UserRole.STAFF,
    warehouses: [9],
  },
  {
    username: 'staff.haiphong',
    fullName: 'Trịnh Văn Nam',
    role: UserRole.STAFF,
    warehouses: [10],
  },
  {
    username: 'staff.binhduong',
    fullName: 'Mai Thị Oanh',
    role: UserRole.STAFF,
    warehouses: [11, 12],
  },
  {
    username: 'staff.nhatrang',
    fullName: 'Tạ Quang Phúc',
    role: UserRole.STAFF,
    warehouses: [13, 14],
  },
  {
    username: 'tech.south',
    fullName: 'Châu Minh Quân',
    role: UserRole.TECHNICIAN,
    warehouses: [0, 1, 2, 3, 9, 11, 12, 14],
  },
  {
    username: 'tech.north',
    fullName: 'Kiều Văn Sơn',
    role: UserRole.TECHNICIAN,
    warehouses: [4, 5, 6, 10],
  },
  {
    username: 'tech.central',
    fullName: 'Lương Thị Tâm',
    role: UserRole.TECHNICIAN,
    warehouses: [7, 8, 13],
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

// 16 installed (one per room for the first 16 rooms) + 2 provisioned + 2
// registered, i.e. ready to be claimed / not yet flashed.
const DEVICE_COUNT = 20;
const INSTALLED_DEVICES = 16;

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

async function seedMasterData(): Promise<void> {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_DEMO_PASSWORD is required — the password given to every seeded demo account.',
    );
  }

  await AppDataSource.initialize();
  try {
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

      for (const p of PRODUCT_TYPES) {
        await findOrCreate(
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
            email: `${u.username}@coldchain.local`,
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
