import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '../libs/constants/user.constant';
import { User } from '../modules/users/entities/user.entity';
import AppDataSource from '../database/data-source';

// Same hashing convention as UsersService.create() — must match, since a
// user created here has to be able to log in through the normal /auth/login
// path afterwards.
const SALT_ROUNDS = 10;

// Bootstraps the very first Admin account so the system isn't stuck with no
// way to create other users through the (Admin-only) API. Safe to run
// repeatedly: no-ops once any Admin account already exists (soft-deleted
// ones don't count, same as every other query in the app).
//
// Usage: `pnpm run seed:admin` (reads SEED_ADMIN_* from the environment —
// see server/.env — never hardcode a real admin password here).
async function seedAdmin(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const email = process.env.SEED_ADMIN_EMAIL ?? null;
  const fullName = process.env.SEED_ADMIN_FULL_NAME ?? 'Administrator';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required — set it in the environment before running this script.',
    );
  }

  await AppDataSource.initialize();

  try {
    const usersRepository = AppDataSource.getRepository(User);

    const existingAdmin = await usersRepository.findOne({
      where: { role: UserRole.ADMIN },
    });
    if (existingAdmin) {
      console.log(
        `Skipped: an admin account already exists ("${existingAdmin.username}").`,
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const admin = usersRepository.create({
      username,
      email,
      passwordHash,
      fullName,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    await usersRepository.save(admin);

    console.log(`Created admin account "${username}".`);
  } finally {
    await AppDataSource.destroy();
  }
}

seedAdmin().catch((error: unknown) => {
  console.error('Seeding admin account failed:', error);
  process.exitCode = 1;
});
