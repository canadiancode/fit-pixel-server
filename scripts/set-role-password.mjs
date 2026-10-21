#!/usr/bin/env node
/**
 * Give a least-privilege role LOGIN and a fresh random password, then write its
 * connection string to an env file. Run `npm run db:migrate` first.
 *
 *   node scripts/set-role-password.mjs <role> <ENV_KEY> [env file] [next step]
 *
 * - db:push-role       fit_pixel_push → PUSH_DATABASE_URL in .env
 *                      (then `npm run db:sync-droplet-env` to ship it)
 * - db:dashboard-role  fit_pixel_dashboard → DASHBOARD_DATABASE_URL in
 *                      ../fit-pixel-dashboard/.env.local
 *
 * Never prints the password or a connection string. The password is hashed
 * locally into a SCRAM-SHA-256 verifier, so plaintext never reaches the server
 * or its statement logs. Re-running rotates the password.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env") });

const [ROLE, ENV_KEY, envFile = ".env", nextStep = ""] = process.argv.slice(2);
if (!/^fit_pixel_[a-z_]+$/.test(ROLE ?? "") || !/^[A-Z_]+$/.test(ENV_KEY ?? "")) {
  console.error("Usage: node scripts/set-role-password.mjs <role> <ENV_KEY> [env file] [next step]");
  process.exit(1);
}
const envPath = join(root, envFile);
const SCRAM_ITERATIONS = 4096;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Set it in .env (gitignored) first.");
  process.exit(1);
}

/** Postgres SCRAM-SHA-256 verifier (RFC 5802 / 7677), as pg stores it. */
function scramVerifier(password) {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** Same URL with the role's user. Pooler users are `<role>.<project-ref>`. */
function roleUrl(adminUrl, password) {
  const url = new URL(adminUrl);
  const user = decodeURIComponent(url.username);
  const dot = user.indexOf(".");
  url.username = encodeURIComponent(dot === -1 ? ROLE : `${ROLE}${user.slice(dot)}`);
  url.password = encodeURIComponent(password);
  return url.toString();
}

function upsertEnv(key, value) {
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n") : [];
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index === -1) {
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${key}=${value}`, "");
  } else {
    lines[index] = `${key}=${value}`;
  }
  writeFileSync(envPath, lines.join("\n"));
}

const password = randomBytes(32).toString("base64url");
const verifier = scramVerifier(password);
if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
  console.error("Could not build the password verifier.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: true,
    ca: [
      ...rootCertificates,
      readFileSync(join(root, "certs", "supabase-root-2021-ca.crt"), "utf8"),
    ],
  },
});
await client.connect();
try {
  const { rowCount } = await client.query("select 1 from pg_roles where rolname = $1", [
    ROLE,
  ]);
  if (rowCount === 0) {
    console.error(`Role ${ROLE} doesn't exist. Run npm run db:migrate first.`);
    process.exit(1);
  }
  // ALTER ROLE can't take bind parameters; the verifier is checked above.
  await client.query(`alter role ${ROLE} with login password '${verifier}'`);
} finally {
  await client.end();
}

upsertEnv(ENV_KEY, roleUrl(databaseUrl, password));
console.log(`${ROLE} can log in. ${ENV_KEY} written to ${envFile}.${nextStep ? ` ${nextStep}` : ""}`);
