#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql using DATABASE_URL.
 * Never prints the connection string.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is missing. Set it in .env (gitignored) then re-run npm run db:migrate.",
  );
  process.exit(1);
}

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No SQL files in supabase/migrations");
  process.exit(1);
}

for (const name of files) {
  const file = join(dir, name);
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
  if (result.error) {
    console.error("psql failed to start. Install PostgreSQL client tools.");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Migration failed: ${name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Applied ${files.length} migration(s).`);
