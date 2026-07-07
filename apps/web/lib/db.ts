/**
 * Prisma Client singleton. Prisma 7's generated client requires an explicit
 * driver adapter (no more implicit "read DATABASE_URL from the schema"
 * runtime path) — libsql is used here for local file SQLite, chosen over
 * the native better-sqlite3 adapter for simpler cross-platform installs.
 *
 * Standard Next.js dev-mode pattern: cache the client on `globalThis` so
 * hot-reloading doesn't spawn a new client (and a new DB connection) on
 * every file save.
 */

import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
