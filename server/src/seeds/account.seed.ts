import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { UserRole, UserStatus } from '../libs/constants/user.constant';
import { User } from '../modules/users/entities/user.entity';
import AppDataSource from '../database/data-source';

// Same hashing convention as UsersService.create() — must match, since a
// user created here has to be able to log in through the normal /auth/login
// path afterwards.
const SALT_ROUNDS = 10;

// One starter account per non-Admin role, sharing the Admin's password;
// SEED_<PREFIX>_USERNAME / _EMAIL / _FULL_NAME override the defaults.
const ROLE_ACCOUNTS = [
  {
    role: UserRole.MANAGER,
    prefix: 'MANAGER',
    username: 'manager',
    fullName: 'Quản lý kho',
  },
  {
    role: UserRole.TECHNICIAN,
    prefix: 'TECHNICIAN',
    username: 'technician',
    fullName: 'Kỹ thuật viên',
  },
  {
    role: UserRole.STAFF,
    prefix: 'STAFF',
    username: 'staff',
    fullName: 'Nhân viên',
  },
] as const;

interface AccountSpec {
  role: UserRole;
  username: string;
  email: string | null;
  fullName: string;
  password: string;
}

function readAccount(
  prefix: string,
  defaults: { role: UserRole; username: string; fullName: string },
  password: string,
): AccountSpec {
  return {
    role: defaults.role,
    username: process.env[`SEED_${prefix}_USERNAME`] ?? defaults.username,
    email: process.env[`SEED_${prefix}_EMAIL`] ?? null,
    fullName: process.env[`SEED_${prefix}_FULL_NAME`] ?? defaults.fullName,
    password,
  };
}

async function createAccount(
  usersRepository: Repository<User>,
  spec: AccountSpec,
): Promise<void> {
  const passwordHash = await bcrypt.hash(spec.password, SALT_ROUNDS);
  await usersRepository.save(
    usersRepository.create({
      username: spec.username,
      email: spec.email,
      passwordHash,
      fullName: spec.fullName,
      role: spec.role,
      status: UserStatus.ACTIVE,
    }),
  );
  console.log(`Created ${spec.role} account "${spec.username}".`);
}

// Bootstraps the very first Admin account so the system isn't stuck with no
// way to create other users through the (Admin-only) API, plus one Manager,
// Technician and Staff account (same password as the Admin) to try each
// role with. Safe to run repeatedly: the Admin step no-ops once any
// Admin account exists, and a role account is skipped when its username is
// already taken (soft-deleted accounts don't count, same as every other
// query in the app). Role accounts start with no warehouse: an Admin assigns
// them from the warehouse's detail dialog.
//
// Usage: `pnpm run seed:admin` (reads SEED_ADMIN_* and the optional
// SEED_MANAGER_* / SEED_TECHNICIAN_* / SEED_STAFF_* usernames from the
// environment — see server/.env — never hardcode a real password here).
async function seedAccounts(): Promise<void> {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required — set it in the environment before running this script.',
    );
  }
  const admin = readAccount(
    'ADMIN',
    { role: UserRole.ADMIN, username: 'admin', fullName: 'Administrator' },
    password,
  );
  const roleAccounts = ROLE_ACCOUNTS.map((a) =>
    readAccount(a.prefix, a, password),
  );

  await AppDataSource.initialize();

  try {
    const usersRepository = AppDataSource.getRepository(User);

    const existingAdmin = await usersRepository.findOne({
      where: { role: UserRole.ADMIN },
    });
    if (existingAdmin) {
      console.log(
        `Skipped admin: an admin account already exists ("${existingAdmin.username}").`,
      );
    } else {
      await createAccount(usersRepository, admin);
    }

    for (const spec of roleAccounts) {
      const taken = await usersRepository.existsBy({
        username: spec.username,
      });
      if (taken) {
        console.log(
          `Skipped ${spec.role}: username "${spec.username}" already exists.`,
        );
        continue;
      }
      await createAccount(usersRepository, spec);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

seedAccounts().catch((error: unknown) => {
  console.error('Seeding accounts failed:', error);
  process.exitCode = 1;
});
