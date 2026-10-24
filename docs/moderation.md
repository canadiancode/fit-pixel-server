# Moderation

Fit Pixel has user-generated content: gym chats, DMs, display names and bios. Apple's Guideline 1.2 requires four things: a filter, reporting, blocking, and a published contact (hello@fitpixel.app on /support, /privacy and /terms). It also requires acting on reports within 24 hours. This is how each part works and what to do when a report comes in.

## The filter

It lives in Postgres (`supabase/migrations/20261030000000_content_moderation.sql`), so it applies however a row is written: through the API or straight through PostgREST.

| Text | `block` patterns | `mask` patterns (mild swearing) | `name_only` patterns |
|---|---|---|---|
| Chat messages (gym + DM) | rejected | shown as `f***` | not checked |
| Bios | rejected | masked | not checked |
| Display names | rejected | rejected | rejected (e.g. "Admin", "Fit Pixel Support") |

Text is normalized before matching: lowercased, leetspeak undone (`n1gg3r`, `$lut`), spaced or dotted letters joined (`k y s`, `r.e.t.a.r.d`). Display names also get a gamer-tag pass (`xXfuckerXx`, `GymRatFucker`). Matching is whole-word, so "Scunthorpe", "rapeseed", "shiitake" and "Dixon" are fine.

A blocked message comes back to the app as `422 CONTENT_BLOCKED` ("That message breaks our community rules. Keep it friendly."); the composer keeps the draft. A blocked name or bio in a sync op is rejected (not retried), so nobody else ever sees it.

**Tune it** in Supabase → SQL Editor:

```sql
-- See the list
select action, pattern, note from public.moderation_patterns order by action, pattern;

-- Add a word or phrase (POSIX regex, matched as whole words, lowercase)
insert into public.moderation_patterns (pattern, action, note) values ('s+c+a+m+m+e+r+s?', 'block', 'spam');

-- Allow something again
delete from public.moderation_patterns where pattern = 'p+r+i+c+k+s?';

-- Test any text before changing anything (second argument: true = check as a display name)
select public.moderation_check('your text here', false);
```

## Reports

Every report is saved in `public.content_reports` and emailed to `ALERT_EMAIL_TO` (hello@fitpixel.app) through Resend. The email includes the reason, the reported message, both users, and the SQL to act on it.

Until `RESEND_API_KEY` is set on the server, alerts are only written to the API log. Set it up once:

1. Create a free account at resend.com and add the domain **fitpixel.app**.
2. Add the DNS records Resend shows (SPF/DKIM) at GoDaddy, **next to** the Google Workspace records. Don't replace them.
3. Create an API key and put it in `fit-pixel-server/.env` as `RESEND_API_KEY=…`.
4. `npm run db:sync-droplet-env` copies it to the droplet and reloads the API.
5. File a test report from the app and check that the email arrives.

The same Resend account can also be Supabase's custom SMTP sender for sign-up and password-reset emails.

**Open reports**, any time:

```sql
select r.created_at, r.reason, r.details, r.message_body, r.reported_user_id, p.display_name as reported_name
from public.content_reports r
left join public.profiles p on p.user_id = r.reported_user_id
where r.created_at > now() - interval '7 days'
order by r.created_at desc;
```

## Acting on a report (within 24 hours)

```sql
-- 1. Hide one message (it disappears for everyone; the row stays for the record)
update public.messages set deleted_at = now() where id = '<message id>';

-- 2. Hide everything a user has sent
update public.messages set deleted_at = now() where sender_id = '<user id>' and deleted_at is null;

-- 3. Ban the user: they can't sign in or refresh their session again.
--    (Any open session ends within the hour, when its token expires.)
update auth.users set banned_until = 'infinity' where id = '<user id>';

-- 4. Clear an offensive name or bio
update public.profiles set display_name = 'Pixel', bio = null where user_id = '<user id>';

-- Undo a ban
update auth.users set banned_until = null where id = '<user id>';
```

If the content involves a child or a credible threat to someone's safety, also report it to the authorities (in Canada: cybertip.ca for child exploitation; local police for threats).
