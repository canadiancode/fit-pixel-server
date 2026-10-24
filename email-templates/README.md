# Auth emails

Pixel-styled Supabase Auth emails. They're generated from one layout by `node scripts/build-email-templates.mjs`; edit the script, never the HTML.

| Supabase template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your Fit Pixel account |
| Reset password | `reset-password.html` | Reset your Fit Pixel password |

Both links land on this server's `/auth/callback` page. Reset links show the "choose a new password" form; confirmation links show "You're all set, open the app". Images and the pixel font load from `https://api.aurashields.com/auth/assets/`.

## One-time setup (about 20 minutes)

One Resend account sends three things: sign-up confirmations, password resets (both through Supabase), and the server's report alerts.

### 1. Resend
1. Sign up at **resend.com** with hello@fitpixel.app.
2. **Domains → Add domain → `fitpixel.app`** (region: North America).
3. Resend shows 3–4 DNS records: an MX and a TXT on `send.fitpixel.app`, a DKIM TXT on `resend._domainkey`, and optionally DMARC. Add them **exactly as shown** at GoDaddy (DNS → Add record). They live on their own names, so they **don't touch** the Google Workspace MX/SPF/DKIM records on the root domain. Don't edit or delete those.
4. Back in Resend, click **Verify**. DNS can take a few minutes up to an hour.
5. **API Keys → Create**, twice, both with "Sending access" for fitpixel.app:
   - `supabase-smtp`, for Supabase (step 2)
   - `server-alerts`, for report alerts (step 4)

### 2. Supabase → Authentication
1. **Emails → SMTP Settings → Enable custom SMTP**
   - Sender email: `hello@fitpixel.app` · Sender name: `Fit Pixel` (replies land in your Gmail)
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: the `supabase-smtp` key
2. **Rate Limits:** raise "Rate limit for sending emails" to about **100 per hour** (custom SMTP starts low).
3. **Emails → Templates:**
   - *Confirm signup*: subject `Confirm your Fit Pixel account`, paste all of `confirm-signup.html` into the body.
   - *Reset password*: subject `Reset your Fit Pixel password`, paste all of `reset-password.html`.
4. **URL Configuration:** Site URL `https://fitpixel.app`. Redirect URLs must include `https://api.aurashields.com/auth/callback`.
5. **Sign In / Providers → Email:** turn **Confirm email** on. Accounts that already exist were confirmed automatically and aren't affected.

### 3. Test on your phone
- Sign up with a new address you can read (a Gmail `+test` alias works: `you+fp1@gmail.com`) → the app shows "Check your email" → the email arrives (check spam the first time) → the link shows "You're all set" → sign in in the app.
- Settings → sign out → "Forgot password" → the email arrives → choose a new password → sign in with it.

### 4. Report alerts
Add the `server-alerts` key to `fit-pixel-server/.env` as `RESEND_API_KEY=re_…`, then run `npm run db:sync-droplet-env` to copy it to the droplet and reload. File a report from the app and check that the alert reaches hello@fitpixel.app. See `docs/moderation.md`.
