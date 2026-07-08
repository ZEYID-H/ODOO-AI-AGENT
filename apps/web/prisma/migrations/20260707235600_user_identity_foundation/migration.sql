/*
  Delivery Management D1 — minimal identity foundation.

  Hand-edited from the generated version (which could not add three required
  columns to a non-empty table): existing rows are backfilled fail-closed —
  username = id (guaranteed unique), passwordHash = '' (bcrypt.compare
  against an empty string can never succeed, so no backfilled row is
  loggable until the seed script sets a real hash), role = 'OWNER'
  (pre-D1, every existing row was by definition the single personal owner).
  The seed script (scripts/seed-users.ts) then renames the "personal-user"
  row to username "admin" and gives it a real password hash.
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL
);
INSERT INTO "new_User" ("createdAt", "id", "username", "passwordHash", "role")
SELECT "createdAt", "id", "id", '', 'OWNER' FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
