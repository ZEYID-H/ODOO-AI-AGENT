/**
 * Account provisioning for the minimal identity foundation (Delivery D1).
 * This script is the ONLY way accounts are created — there is deliberately
 * no user-management UI (see docs/DELIVERY_MANAGEMENT_PLAN.md, D1
 * implementation notes). User administration will become its own future
 * module.
 *
 * Usage:
 *   npx tsx scripts/seed-users.ts        (or: npm run db:seed)
 *
 * Reads one env var per account (below); accounts whose env var is unset
 * are skipped, so this is safe to run on every container start
 * (docker-entrypoint.sh does exactly that). Idempotent: existing accounts
 * get their password/role updated to match the env — which is also the
 * only password-rotation mechanism until a real admin module exists.
 *
 * The owner keeps the fixed id "personal-user": that id owns all pre-D1
 * conversation history, so seeding the owner under a fresh id would
 * silently orphan it (see docs/DELIVERY_MANAGEMENT_PLAN.md §2).
 *
 * Passwords are read from the environment, hashed with bcrypt, and never
 * printed or logged.
 */

import { hash } from "bcryptjs";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const BCRYPT_COST = 10;

interface SeedAccount {
  username: string;
  role: "OWNER" | "DRIVER";
  envVar: string;
  fixedId?: string;
}

const ACCOUNTS: SeedAccount[] = [
  { username: "admin", role: "OWNER", envVar: "SEED_ADMIN_PASSWORD", fixedId: "personal-user" },
  { username: "driver_ahmed", role: "DRIVER", envVar: "SEED_DRIVER_AHMED_PASSWORD" },
  { username: "driver_mohammed", role: "DRIVER", envVar: "SEED_DRIVER_MOHAMMED_PASSWORD" },
  { username: "driver_ali", role: "DRIVER", envVar: "SEED_DRIVER_ALI_PASSWORD" },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });

  try {
    for (const account of ACCOUNTS) {
      const password = process.env[account.envVar];
      if (!password) {
        console.log(`[seed-users] ${account.username}: skipped (${account.envVar} not set)`);
        continue;
      }

      const passwordHash = await hash(password, BCRYPT_COST);
      const data = { username: account.username, passwordHash, role: account.role };

      if (account.fixedId) {
        // Upsert by id, not username: the fixed-id row may exist from
        // before D1 under a backfilled username (= its id).
        await prisma.user.upsert({
          where: { id: account.fixedId },
          update: data,
          create: { id: account.fixedId, ...data },
        });
      } else {
        await prisma.user.upsert({
          where: { username: account.username },
          update: data,
          create: data,
        });
      }
      console.log(`[seed-users] ${account.username}: provisioned (role ${account.role})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed-users] failed:", error);
  process.exit(1);
});
