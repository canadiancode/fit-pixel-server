# Fit Pixel Server

Node.js + Express + TypeScript API for the **Fit Pixel** Expo app (`one-rep-max`).

Auth is **Supabase Auth** (verified JWTs via JWKS). User data is Postgres with RLS (`user_id = auth.uid()`). The API uses the **user JWT** for ingest — the service role is for droplet admin jobs only and is never used on request paths.

## Setup

```bash
npm install
cp .env.example .env
# Fill SUPABASE_URL + SUPABASE_ANON_KEY (and DATABASE_URL to apply migrations)
npm run db:migrate
npm run dev
```

Default port: `3001` (`PORT` in `.env`).

## Health checks

```bash
curl http://localhost:3001/health
# {"ok":true,"status":"up"}

curl http://localhost:3001/ready
# {"ok":true,"status":"ready","supabaseConfigured":true|false}
```

`/health` and `/ready` stay public. `/ready` reports `supabaseConfigured: true` only when both `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set. Authenticated routes return **503** if `SUPABASE_URL` is missing (fail closed).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with `tsx watch` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply `supabase/migrations/*.sql` via `DATABASE_URL` (never prints the URL) |

## Endpoints

| Method | Path | Auth | Status |
|--------|------|------|--------|
| `GET` | `/health` | no | Live |
| `GET` | `/ready` | no | Live (`supabaseConfigured` boolean, no secrets) |
| `GET` | `/.well-known/apple-app-site-association` | no | Universal Links stub |
| `GET` | `/.well-known/assetlinks.json` | no | App Links stub |
| `GET` | `/auth/callback` | no | HTTPS callback stub (not scheme-only OAuth) |
| `POST` | `/v1/sync` | JWT | Ingest outbox ops; `{ acks, serverTime }` |
| `GET` | `/v1/me` | JWT | `{ id, email }` from verified claims |
| `GET` | `/v1/habits` | JWT | Stub `501` |
| `GET` | `/v1/food/search?q=` | JWT | Live if FatSecret env set; else stub |
| `GET` | `/v1/food/:id` | JWT | Live if FatSecret env set; else stub |
| `GET` | `/v1/gyms` | JWT | Gym catalog + member counts + joined |
| `GET` | `/v1/gyms/:gymId` | JWT | One gym |
| `POST` | `/v1/gyms/:gymId/join` | JWT | Join gym chat |
| `DELETE` | `/v1/gyms/:gymId/leave` | JWT | Leave gym chat |
| `GET` | `/v1/gyms/:gymId/messages` | JWT | Gym message history |
| `POST` | `/v1/gyms/:gymId/messages` | JWT | Send gym message |
| `GET` | `/v1/me/gym-chats` | JWT | Joined gym chats |
| `GET` | `/v1/dms` | JWT | DM inbox |
| `POST` | `/v1/dms` | JWT | Find-or-create DM `{ peerUserId }` |
| `GET` | `/v1/dms/:conversationId/messages` | JWT | DM history |
| `POST` | `/v1/dms/:conversationId/messages` | JWT | Send DM |
| `GET` | `/v1/pixels/search?q=` | JWT | Search display names |
| `GET` | `/v1/pixels/:userId` | JWT | Public chat author |

There is **no** `/v1/auth/*`. Signup / login / reset go to Supabase Auth from the app.

Auth middleware verifies Supabase access tokens with JWKS (`iss` = `{SUPABASE_URL}/auth/v1`, `aud` = `authenticated`, `exp` checked).

### Food search / detail (Expo custom-meal compatible)

Food routes require a verified JWT. Response shapes are unchanged from the FatSecret proxy.

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

Expo: call search with a user JWT → show rows → on select either use search macros for a quick log, or fetch `/:id` and pass `habitPayload` (or a chosen serving) into `addFood()`.

Stub / error responses look like:

```json
{
  "ok": false,
  "code": "NOT_IMPLEMENTED",
  "message": "..."
}
```

### Env

See [`.env.example`](.env.example). Put real values only in gitignored `.env` (local + droplet).

- `SUPABASE_URL` — required for JWT (JWKS). Missing ⇒ authenticated routes 503. `/ready` also needs `SUPABASE_ANON_KEY`.
- `SUPABASE_ANON_KEY` — user-scoped PostgREST client (with the caller JWT).
- `SUPABASE_SERVICE_ROLE_KEY` — droplet/local only; unused on request paths; never `EXPO_PUBLIC_*`.
- `DATABASE_URL` — Postgres URI for `npm run db:migrate`.

FatSecret (optional for food proxy; keep secrets on the server only):

- `FATSECRET_CLIENT_ID`
- `FATSECRET_CLIENT_SECRET`

`CORS_ORIGINS` is a comma-separated browser allowlist. Empty or `*` means no browser CORS (native Expo and curl still work). Never combine `*` with credentials. Production should leave it empty until there is a web app.

### Supabase dashboard (existing project — do not recreate)

- Email provider **on**; third-party OAuth **off**; magic-link sign-in **off**.
- Site URL: `https://api.aurashields.com`
- Redirect allowlist: `https://api.aurashields.com/auth/callback`
- Confirm-email: prefer off for password signup this pass, or HTTPS callback only — never scheme-only `onerepmax://`.

SQL lives in [`supabase/migrations`](supabase/migrations). Apply with `npm run db:migrate` (needs `DATABASE_URL`). GitHub Actions does **not** run migrations — apply once on the droplet after deploy if needed.

## Sync contract

The mobile app is offline-first with a SQLite `pending_server_ops` outbox. It drains to `POST /v1/sync` with the user JWT. Types live in [`src/types/sync.ts`](src/types/sync.ts).

`POST /v1/sync` body: `{ ops }` (max 500). Each op has a UUID id, `schemaVersion: 1`, and a **per-type** payload (Zod). Client `trust` is ignored; the server uses `trustForOpType`.

Response:

```ts
{
  acks: Array<{ id: string; status: "synced" | "rejected"; reason?: string }>;
  serverTime: string; // ISO
}
```

### Trust rules

- **FACTS** (persist after sanitization): `habit_log`, `daily_goals`, `loadout`, `profile`, `prefs`, `saved_meal`
- **UNTRUSTED** (ack `synced` with `ignored_untrusted`; do not persist as score/ownership): `xp_award`, `inventory_unlock`
- Recompute XP / level into `xp_state` from `habit_log` + `daily_goals`
- Do not trust client `dayKey` — re-derive from timestamp + stored timezone / day-start
- Ignore client `source` for scoring; never store raw HealthKit sample blobs
- `profileVisible` is a server publish gate (default hidden)
- Socials: `https://` or `@handle` only

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
# NODE_ENV=production, PORT=3001, CORS_ORIGINS= (empty)
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
# plus FatSecret when used
pm2 reload fit-pixel-api --update-env
```

Apply SQL once (does not print the URL):

```bash
cd /var/www/fit-pixel-server
npm run db:migrate
```

Issue TLS (after DNS points here), then install the committed HTTP→HTTPS config:

```bash
certbot --nginx -d api.aurashields.com --agree-tos --redirect -m YOUR_EMAIL@example.com
sudo cp /var/www/fit-pixel-server/deploy/nginx-api.aurashields.com.conf /etc/nginx/sites-available/api.aurashields.com
sudo nginx -t && sudo systemctl reload nginx
```

GitHub Actions reloads Node only; it does **not** copy nginx. After a nginx change lands on `main`, apply it once on the droplet with the `cp` / `nginx -t` / `reload` commands above.

Verify:

```bash
curl -sI http://api.aurashields.com/health | head -n 1
# HTTP/1.1 301 Moved Permanently

curl -fsS https://api.aurashields.com/health
# {"ok":true,"status":"up"}
```

#### 4. Ongoing deploys

Push or merge to `main` → Actions runs **Deploy** → PM2 reloads. No manual SSH needed.

Local files used in production:

- [`ecosystem.config.cjs`](ecosystem.config.cjs) — PM2 app name `fit-pixel-api`
- [`deploy/nginx-api.aurashields.com.conf`](deploy/nginx-api.aurashields.com.conf) — HTTP 301 → HTTPS, HSTS, reverse proxy to `:3001`
- [`deploy/bootstrap.sh`](deploy/bootstrap.sh) — one-time server setup

## Next

OAuth / magic-link wait on real Universal Links (replace the TEAMID / SHA-256 stubs). `GET /v1/habits` and food rate limits are later.

# deploy-test 2026-08-07T04:33:11Z

# deploy-test 2026-08-07T04:37:46Z

# deploy-test 2026-08-07T04:47:39Z

# deploy-test 2026-08-07T04:51:06Z
