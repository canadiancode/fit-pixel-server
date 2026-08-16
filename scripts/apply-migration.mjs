#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql using DATABASE_URL.
 * Never prints the connection string.
 *
 * Prefers the `pg` driver (works without local `psql`). Falls back to `psql`.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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

function applyWithPsql(file) {
  const result = spawnSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", file],
    {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    },
  );
  if (result.error) {
    return { ok: false, missingBinary: true };
  }
  if (result.status !== 0) {
    return { ok: false, missingBinary: false };
  }
  return { ok: true, missingBinary: false };
}

async function applyWithPg(file) {
  const pg = await import("pg");
  const Client = pg.default?.Client ?? pg.Client;
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(readFileSync(file, "utf8"));
  } finally {
    await client.end();
  }
}

let usedPg = false;
try {
  await import("pg");
  usedPg = true;
} catch {
  usedPg = false;
}

for (const name of files) {
  const file = join(dir, name);
  if (usedPg) {
    try {
      await applyWithPg(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.error(`Migration failed: ${name}`);
      console.error(message);
      process.exit(1);
    }
    continue;
  }

  const result = applyWithPsql(file);
  if (result.ok) continue;
  if (result.missingBinary) {
    console.error(
      "psql failed to start. Install PostgreSQL client tools, or `npm install pg`.",
    );
    process.exit(1);
  }
  console.error(`Migration failed: ${name}`);
  process.exit(1);
}

console.log(`Applied ${files.length} migration(s).`);
