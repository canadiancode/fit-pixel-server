#!/usr/bin/env node
/**
 * Builds the Supabase Auth email templates in email-templates/ from one
 * layout, so the confirm and reset emails always match. Paste the output into
 * Supabase → Authentication → Emails (see email-templates/README.md).
 *
 * Email clients are not browsers: tables + inline styles only, no scripts,
 * images by absolute URL (served from public/auth on the API), and the pixel
 * font only where the client supports web fonts (Apple Mail / iOS Mail);
 * everywhere else it falls back to a bold monospace.
 *
 *   node scripts/build-email-templates.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "email-templates");
const ASSETS = "https://api.aurashields.com/auth/assets";
const CONTACT = "hello@fitpixel.app";

const PIXEL = "'Press Start 2P', 'PressStart2P', 'Courier New', Courier, monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Supabase fills these in (Go templates). */
const LINK = "{{ .ConfirmationURL }}";

function layout({ preheader, title, intro, button, outro }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${title}</title>
<style>
  @font-face { font-family: 'Press Start 2P'; src: url('${ASSETS}/PressStart2P-Regular.ttf') format('truetype'); }
  a { color: #22c8ff; }
  @media (max-width: 560px) { .card { width: 100% !important; } .pad { padding: 28px 22px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#011a35;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#011a35;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#011a35;">
  <tr>
    <td align="center" style="padding:36px 12px;">
      <table role="presentation" class="card" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:520px;background:#02284f;border:4px solid #03418c;border-radius:14px;">
        <tr>
          <td class="pad" align="center" style="padding:40px 40px 34px;">
            <img src="${ASSETS}/app-icon.png" width="72" height="72" alt="Fit Pixel" style="display:block;border:0;border-radius:16px;margin:0 auto 18px;">
            <div style="font-family:${PIXEL};font-size:18px;font-weight:bold;letter-spacing:1px;line-height:1.4;">
              <span style="color:#ffffff;">FIT</span> <span style="color:#22c8ff;">PIXEL</span>
            </div>
            <div style="height:28px;line-height:28px;">&nbsp;</div>
            <h1 style="margin:0 0 18px;font-family:${PIXEL};font-size:17px;font-weight:bold;line-height:1.6;color:#ffd21a;text-transform:uppercase;">${title}</h1>
            <p style="margin:0 0 28px;font-family:${SANS};font-size:16px;line-height:1.6;color:#d8e6ff;">${intro}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" bgcolor="#7fe000" style="background:#7fe000;border:4px solid #000000;border-radius:4px;">
                  <a href="${LINK}" style="display:inline-block;padding:16px 28px;font-family:${PIXEL};font-size:14px;font-weight:bold;line-height:1.3;color:#000000;text-decoration:none;text-transform:uppercase;">${button}</a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0;font-family:${SANS};font-size:14px;line-height:1.6;color:#a9c1e6;">${outro}</p>
            <p style="margin:22px 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#7f97bd;">Button not working? Paste this link into your browser:<br><a href="${LINK}" style="color:#22c8ff;word-break:break-all;">${LINK}</a></p>
          </td>
        </tr>
      </table>
      <p style="margin:22px 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#7f97bd;">
        Fit Pixel · <a href="mailto:${CONTACT}" style="color:#7f97bd;">${CONTACT}</a> · <a href="https://fitpixel.app" style="color:#7f97bd;">fitpixel.app</a>
      </p>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

const TEMPLATES = [
  {
    file: "confirm-signup.html",
    subject: "Confirm your Fit Pixel account",
    html: layout({
      preheader: "One tap and your Pixel is ready to level up.",
      title: "Press start",
      intro: "Confirm your email to finish creating your Fit Pixel account. Then open the app and start earning XP.",
      button: "Confirm email",
      outro: "Didn't sign up for Fit Pixel? You can ignore this email and no account will be created.",
    }),
  },
  {
    file: "reset-password.html",
    subject: "Reset your Fit Pixel password",
    html: layout({
      preheader: "Choose a new password for your Fit Pixel account.",
      title: "Reset your password",
      intro: "Someone (hopefully you) asked to reset the password for your Fit Pixel account. Tap below to choose a new one. The link works once and expires soon.",
      button: "Choose new password",
      outro: "Didn't ask for this? You can ignore this email. Your password won't change.",
    }),
  },
];

mkdirSync(OUT, { recursive: true });
for (const t of TEMPLATES) {
  writeFileSync(join(OUT, t.file), t.html);
  console.log(`${t.file}  (subject: ${t.subject})`);
}
