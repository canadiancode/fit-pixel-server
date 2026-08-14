# Fit Pixel Server

Node.js + Express + TypeScript API for the **Fit Pixel** Expo app (`one-rep-max`).

This pass scaffolds the API shape, middleware, env config, and stub handlers. **Supabase / Postgres / real auth & sync persistence come next** — there is no database in this pass.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Default port: `3001` (`PORT` in `.env`).

## Health checks

No database required:

```bash
curl http://localhost:3001/health
# {"ok":true,"status":"up"}

curl http://localhost:3001/ready
# {"ok":true,"status":"ready"}
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with `tsx watch` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |

## Endpoints

| Method | Path | Auth | Status |
|--------|------|------|--------|
| `GET` | `/health` | no | Live |
| `GET` | `/ready` | no | Live (process-only; DB check later) |
| `POST` | `/v1/auth/signup` | no | Stub `501 NOT_IMPLEMENTED` |
| `POST` | `/v1/auth/login` | no | Stub `501` |
| `POST` | `/v1/auth/logout` | Bearer | Stub `501` |
| `POST` | `/v1/auth/forgot-password` | no | Stub `501` |
| `POST` | `/v1/sync` | Bearer | Stub `501` (validates body) |
| `GET` | `/v1/me` | Bearer | Stub `501` |
| `GET` | `/v1/habits` | Bearer | Stub `501` |
| `GET` | `/v1/food/search?q=` | no | Live if FatSecret env set; else stub |
| `GET` | `/v1/food/:id` | no | Live if FatSecret env set; else stub |

### Food search / detail (Expo custom-meal compatible)

When FatSecret is configured, responses include macros the mobile app already uses for custom food → recent meals → saved meals:

**`GET /v1/food/search?q=toast`** — each item includes habit fields plus list-row aliases:

```json
{
  "ok": true,
  "foods": [
    {
      "id": "1234",
      "name": "Toast",
      "brandName": "Generic",
      "description": "Per Serving - Calories: 170kcal | Fat: 4.00g | Carbs: 30.00g | Protein: 5.00g",
      "kcal": 170,
      "proteinG": 5,
      "carbsG": 30,
      "fatG": 4,
      "portionSize": "Serving",
      "calories": 170,
      "protein": 5,
      "carbs": 30,
      "fat": 4
    }
  ],
  "page": 0,
  "maxResults": 20
}
```

Search macros are parsed from FatSecret’s `food_description` text (same summary FatSecret returns in search).

**`GET /v1/food/:id`** — full servings from FatSecret, plus `habitPayload` ready for `addFood()` / `saveMeal()`:

```json
{
  "ok": true,
  "food": {
    "id": "1234",
    "name": "Toast",
    "brandName": "Generic",
    "servings": [
      {
        "id": "1",
        "description": "1 slice",
        "calories": 170,
        "protein": 5,
        "carbohydrate": 30,
        "fat": 4,
        "kcal": 170,
        "proteinG": 5,
        "carbsG": 30,
        "fatG": 4,
        "portionSize": "1 slice",
        "isDefault": true
      }
    ],
    "habitPayload": {
      "name": "Toast",
      "kcal": 170,
      "proteinG": 5,
      "carbsG": 30,
      "fatG": 4,
      "portionSize": "1 slice",
      "vendor": "Generic"
    }
  }
}
```

Expo wiring (when ready): call search → show rows → on select either use search macros for a quick log, or fetch `/:id` and pass `habitPayload` (or a chosen serving) into `addFood()` the same way custom meal does. Recent meals then appear automatically from `habit_logs`.

Stub responses look like:

```json
{
  "ok": false,
  "code": "NOT_IMPLEMENTED",
  "message": "..."
}
```

Auth middleware currently only checks for `Authorization: Bearer <token>` — it does **not** verify against a database yet.

### Env

See [`.env.example`](.env.example). Optional placeholders for later:

- `DATABASE_URL`
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`

FatSecret (optional for food proxy):

- `FATSECRET_CLIENT_ID`
- `FATSECRET_CLIENT_SECRET`

## Sync contract (planned)

The mobile app is offline-first with a SQLite `pending_server_ops` outbox. It does not call this API yet. Types live in [`src/types/sync.ts`](src/types/sync.ts).

`POST /v1/sync` body:

```ts
{
  ops: Array<{
    id: string; // UUID idempotency key
    type:
      | "habit_log"
      | "daily_goals"
      | "xp_award"
      | "inventory_unlock"
      | "loadout"
      | "profile"
      | "prefs"
      | "saved_meal";
    payload: Record<string, unknown>;
    clientClockAt: string | null;
    schemaVersion: number; // currently 1
    trust: "fact" | "untrusted_client";
  }>;
}
```

Planned response (not returned until persistence exists):

```ts
{
  acks: Array<{ id: string; status: "synced" | "rejected"; reason?: string }>;
  serverTime: string; // ISO
}
```

### Trust rules (for the future DB pass)

- **FACTS** (persist after sanitization): `habit_log`, `daily_goals`, `loadout`, `profile`, `prefs`, `saved_meal`
- **UNTRUSTED** (do not trust for scoring): `xp_award`, `inventory_unlock`
- Recompute XP from `habit_log` + `daily_goals` — never treat client XP as truth
- Do not trust client `dayKey` alone — re-derive from timestamps + day boundary / timezone
- Never store raw HealthKit sample blobs

Habit log payload shape: [`src/types/habits.ts`](src/types/habits.ts).

## Production deploy (DigitalOcean + GitHub Actions)

Production host: **`https://api.aurashields.com`** → droplet `68.183.106.85`.

After the one-time setup below, **merging (or pushing) to `main` deploys** via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): SSH in, `git reset --hard origin/main`, `npm ci`, `npm run build`, `pm2 reload`.

`.env` stays **only on the server** — never commit it and never put it in GitHub Actions secrets.

### One-time checklist

#### 1. GoDaddy DNS

For domain `aurashields.com`:

| Type | Name | Value           | TTL |
|------|------|-----------------|-----|
| A    | api  | 68.183.106.85   | 600 |

Confirm before Certbot:

```bash
dig api.aurashields.com +short
# expect: 68.183.106.85
```

#### 2. SSH key for GitHub Actions

On your Mac:

```bash
ssh-keygen -t ed25519 -C "gha-fit-pixel-deploy" -f ~/.ssh/fit_pixel_deploy -N ""
```

On the droplet (as root), append the **public** key:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'PASTE_CONTENTS_OF_fit_pixel_deploy.pub' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

In GitHub → `canadiancode/fit-pixel-server` → **Settings → Secrets and variables → Actions**, add:

| Secret            | Value                                      |
|-------------------|--------------------------------------------|
| `SSH_HOST`        | `68.183.106.85`                            |
| `SSH_USER`        | `root`                                     |
| `SSH_PRIVATE_KEY` | Full contents of `~/.ssh/fit_pixel_deploy` |

#### 3. Bootstrap the droplet (once)

SSH in as root, then either run the script from a fresh clone or copy-paste:

```bash
# Option A — if the repo is public:
curl -fsSL https://raw.githubusercontent.com/canadiancode/fit-pixel-server/main/deploy/bootstrap.sh -o /tmp/bootstrap.sh
chmod +x /tmp/bootstrap.sh
# If private, clone first with a deploy key, then:
#   bash /var/www/fit-pixel-server/deploy/bootstrap.sh
bash /tmp/bootstrap.sh
```

Or clone then bootstrap:

```bash
git clone https://github.com/canadiancode/fit-pixel-server.git /var/www/fit-pixel-server
bash /var/www/fit-pixel-server/deploy/bootstrap.sh
```

**Private repo:** add a read-only [Deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) on the repo, install that key on the droplet (`~/.ssh` for `git`), and set:

```bash
export REPO_URL=git@github.com:canadiancode/fit-pixel-server.git
bash /var/www/fit-pixel-server/deploy/bootstrap.sh
```

Edit server env (never commit):

```bash
nano /var/www/fit-pixel-server/.env
# NODE_ENV=production, PORT=3001, CORS_ORIGINS=*, plus FatSecret/Supabase when ready
pm2 reload fit-pixel-api --update-env
```

Issue TLS (after DNS points here):

```bash
certbot --nginx -d api.aurashields.com --agree-tos -m YOUR_EMAIL@example.com
```

Verify:

```bash
curl -fsS https://api.aurashields.com/health
# {"ok":true,"status":"up"}
```

#### 4. Ongoing deploys

Push or merge to `main` → Actions runs **Deploy** → PM2 reloads. No manual SSH needed.

Local files used in production:

- [`ecosystem.config.cjs`](ecosystem.config.cjs) — PM2 app name `fit-pixel-api`
- [`deploy/nginx-api.aurashields.com.conf`](deploy/nginx-api.aurashields.com.conf) — nginx reverse proxy to `:3001`
- [`deploy/bootstrap.sh`](deploy/bootstrap.sh) — one-time server setup

## Next

Wire Supabase for auth, sync ingest (idempotency), and user data. Route paths and request types are ready to plug in.

# deploy-test 2026-08-07T04:33:11Z

# deploy-test 2026-08-07T04:37:46Z

# deploy-test 2026-08-07T04:47:39Z

# deploy-test 2026-08-07T04:51:06Z
