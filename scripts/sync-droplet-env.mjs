#!/usr/bin/env node
/**
 * Copy local gitignored Supabase env vars onto the production droplet and reload PM2.
 * Never prints secret values.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});

const KEYS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const optionalKeys = ["DATABASE_URL"];

const missing = KEYS.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Missing local env: ${missing.join(", ")}`);
  process.exit(1);
}

const payload = [...KEYS, ...optionalKeys]
  .filter((key) => process.env[key]?.trim())
  .map((key) => `${key}=${process.env[key]?.trim()}`)
  .join("\n");

const remotePy = `
import pathlib, sys
path = pathlib.Path("/var/www/fit-pixel-server/.env")
text = path.read_text() if path.exists() else ""
incoming = {}
for line in sys.stdin.read().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    incoming[k] = v
seen = set()
out = []
for line in text.splitlines():
    if "=" in line and not line.lstrip().startswith("#") and line.split("=", 1)[0] in incoming:
        k = line.split("=", 1)[0]
        out.append(f"{k}={incoming[k]}")
        seen.add(k)
    else:
        out.append(line)
for k in incoming:
    if k not in seen:
        out.append(f"{k}={incoming[k]}")
path.write_text("\\n".join(out) + "\\n")
print("updated", len(incoming), "keys")
`;

const encoded = Buffer.from(remotePy, "utf8").toString("base64");
const ssh = spawnSync(
  "ssh",
  [
    "-i",
    `${process.env.HOME}/.ssh/fit_pixel_deploy`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "root@68.183.106.85",
    `python3 -c "exec(__import__('base64').b64decode('${encoded}').decode())"`,
  ],
  { input: payload, encoding: "utf8" },
);

if (ssh.status !== 0) {
  console.error(ssh.stderr || "ssh failed");
  process.exit(ssh.status ?? 1);
}

console.log(ssh.stdout.trim() || "Droplet env updated.");

const reload = spawnSync(
  "ssh",
  [
    "-i",
    `${process.env.HOME}/.ssh/fit_pixel_deploy`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "root@68.183.106.85",
    "cd /var/www/fit-pixel-server && pm2 restart fit-pixel-api --update-env",
  ],
  { encoding: "utf8" },
);

if (reload.status !== 0) {
  console.error(reload.stderr || "pm2 restart failed");
  process.exit(reload.status ?? 1);
}

console.log("pm2 restart ok");
