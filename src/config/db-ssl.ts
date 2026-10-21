import { readFileSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";
import type { ConnectionOptions } from "node:tls";

/**
 * Supabase signs its Postgres certificates (direct host and pooler) with its own
 * root, which isn't in Node's bundle. Trusting it plus the public roots keeps
 * full verification (chain + hostname) without pinning one endpoint's CA.
 * Same path from src/config (tsx) and dist/config (node).
 */
const SUPABASE_ROOT_CA_PATH = path.join(
  __dirname,
  "..",
  "..",
  "certs",
  "supabase-root-2021-ca.crt",
);

/** URL params pg would let override the `ssl` option (sslmode=require skips the CA). */
const SSL_URL_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey"];

let cached: ConnectionOptions | undefined;

/** `ssl` option for every pg Pool / Client. */
export function databaseSsl(): ConnectionOptions {
  if (!cached) {
    cached = {
      rejectUnauthorized: true,
      ca: [...tls.rootCertificates, readFileSync(SUPABASE_ROOT_CA_PATH, "utf8")],
    };
  }
  return cached;
}

/** Drops SSL params from a connection string so databaseSsl() always applies. */
export function withoutSslParams(connectionString: string): string {
  const url = new URL(connectionString);
  for (const key of SSL_URL_PARAMS) url.searchParams.delete(key);
  return url.toString();
}
