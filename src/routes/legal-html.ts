import { Router } from "express";

/**
 * Privacy Policy, Terms of Use and Support, served at /privacy, /terms and
 * /support. The public URLs are https://fitpixel.app/privacy, /terms and
 * /support: the website proxies these routes (fit-pixel-website functions/),
 * so the app, App Store Connect and the site all link to fitpixel.app.
 *
 * Static HTML, no scripts. Keep the text in step with what the app and this
 * server actually collect; bump LEGAL_EFFECTIVE_DATE on every change.
 */

/** The monitored Fit Pixel inbox (Google Workspace). */
const LEGAL_CONTACT_EMAIL: string | null = "hello@fitpixel.app";

const LEGAL_EFFECTIVE_DATE = "October 24, 2026";

function contactHtml(): string {
  return LEGAL_CONTACT_EMAIL
    ? `<a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>`
    : "[contact email to be added]";
}

function legalShell(opts: {
  title: string;
  body: string;
  /** Pages that aren't legal text (Support) omit the effective date. */
  showEffectiveDate?: boolean;
}): string {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#02284f" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${opts.title} · Fit Pixel</title>
    <link rel="icon" type="image/png" href="/auth/assets/favicon.png" />
    <style>
      @font-face {
        font-family: "PressStart2P";
        src: url("/auth/assets/PressStart2P-Regular.ttf") format("truetype");
        font-display: swap;
      }
      :root {
        color-scheme: dark;
        --frame: #03418c;
        --bg: #02284f;
        --bg-deep: #011a35;
        --text: #ffffff;
        --muted: #ffffffc7;
        --link: #7cc8ff;
        --pixel: "PressStart2P", ui-monospace, monospace;
        --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        background: radial-gradient(ellipse at top, rgba(3, 65, 140, 0.55), transparent 60%), var(--bg-deep);
        color: var(--text);
        font-family: var(--sans);
        -webkit-font-smoothing: antialiased;
        padding: 24px 16px 48px;
      }
      main {
        max-width: 720px;
        margin: 0 auto;
        background: var(--bg);
        border: 4px solid var(--frame);
        border-radius: 16px;
        padding: 28px 24px 32px;
      }
      .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
      .brand img { width: 40px; height: 40px; border-radius: 10px; image-rendering: pixelated; }
      .brand span { font-family: var(--pixel); font-size: 13px; }
      h1 { font-family: var(--pixel); font-weight: 400; font-size: 18px; line-height: 28px; margin: 0 0 8px; }
      h2 { font-family: var(--pixel); font-weight: 400; font-size: 12px; line-height: 20px; margin: 28px 0 10px; }
      p, li { font-size: 15px; line-height: 23px; color: var(--muted); }
      p { margin: 0 0 12px; }
      ul { margin: 0 0 12px; padding-left: 20px; }
      li { margin-bottom: 6px; }
      strong { color: var(--text); font-weight: 600; }
      a { color: var(--link); }
      .meta { font-size: 13px; color: rgba(255, 255, 255, 0.6); margin-bottom: 20px; }
      nav { margin-top: 32px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.12); font-size: 14px; }
      nav a { margin-right: 16px; }
      @media (max-width: 380px) { main { padding: 22px 16px 26px; } h1 { font-size: 16px; } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <img src="/auth/assets/app-icon.png" alt="" width="40" height="40" />
        <span>Fit Pixel</span>
      </div>
      <h1>${opts.title}</h1>
      ${opts.showEffectiveDate === false ? "" : `<p class="meta">Effective ${LEGAL_EFFECTIVE_DATE}</p>`}
      ${opts.body}
      <nav><a href="/support">Support</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Use</a></nav>
    </main>
  </body>
</html>`;
}

export function renderPrivacyPolicyHtml(): string {
  return legalShell({
    title: "Privacy Policy",
    body: `
      <p>This policy explains what Fit Pixel ("we", "us") collects when you use the Fit Pixel app and its services, why, and the choices you have. Fit Pixel is operated from British Columbia, Canada.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address and password. Passwords are stored hashed by our authentication provider; we never see them.</li>
        <li><strong>Profile:</strong> display name, bio, home gym, the social handles you add (Instagram, TikTok, YouTube), your Pixel's look, and whether your profile is visible to others.</li>
        <li><strong>Habit logs and goals:</strong> the food, water, training, sleep, weight, steps and active-calorie entries you log, any notes you add, your daily goals, saved meals, and settings such as units, theme, time zone and when your day starts. We use these to sync your data across devices and calculate your XP and level.</li>
        <li><strong>Social and chat:</strong> gym chats you join, messages you send in gym chats and direct messages, friend requests and friendships, people you block, and reports you file.</li>
        <li><strong>Notifications:</strong> a push notification token for your device, if you allow notifications.</li>
        <li><strong>Technical data:</strong> our servers log IP addresses, request paths (which can include search terms) and device/browser details to operate and secure the service. If the app crashes, it sends a crash report (device model, OS version, app version and the error) to help us fix it.</li>
      </ul>

      <h2>What stays on your device</h2>
      <ul>
        <li><strong>Apple Health:</strong> with your permission the app reads steps, active energy, resting heart rate, sleep and weight from Apple Health to show them on your dashboard and goals. This data stays on your device. It is only sent to us if you choose to save it as a habit log. Fit Pixel never writes to Apple Health, and never uses Health data for advertising or sells it.</li>
        <li><strong>Location:</strong> if you allow it, your location is used on your device to center the gym map. We do not send or store your location.</li>
      </ul>

      <h2>Who can see your information</h2>
      <ul>
        <li><strong>Other Fit Pixel users</strong> can see your display name and Pixel look, and your level and XP on the leaderboards (your friends' board and the global board, which ranks everyone). Your bio and home gym are shown only if you turn on profile visibility. Messages are visible to the members of the chat they are sent in.</li>
        <li><strong>Service providers</strong> who process data for us: Supabase (database and sign-in), DigitalOcean (API hosting), Expo and Apple (push notifications and app updates), Sentry (crash reports) and FatSecret (food search — we send your search terms, not your identity).</li>
        <li><strong>Legal reasons:</strong> we may disclose information if required by law or to protect the safety of our users.</li>
      </ul>
      <p>We do not sell your personal information and we do not use it for third-party advertising or tracking.</p>

      <h2>Where it is stored</h2>
      <p>Our service providers may store and process data outside British Columbia and Canada, including in the United States, where it may be subject to the laws of that country.</p>

      <h2>How long we keep it</h2>
      <p>We keep your account data while your account exists. When you delete your account (Settings → Account → Delete account), we permanently delete your profile, habit logs, goals, messages, friendships and device tokens. Reports you filed, or that were filed about you, are kept for safety and moderation with your account link removed. Server logs and crash reports are kept for a limited time.</p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Edit your profile, hide your profile, or turn off notifications in Settings at any time.</li>
        <li>Revoke Apple Health or location access in iOS Settings.</li>
        <li>Delete your account and data from within the app.</li>
        <li>Under Canadian privacy law (including PIPEDA and BC's Personal Information Protection Act) you can ask to access or correct your personal information, or withdraw consent. Contact us at ${contactHtml()}.</li>
      </ul>

      <h2>Children</h2>
      <p>Fit Pixel is not intended for anyone under 13, and we do not knowingly collect information from children under 13. If you believe a child has created an account, contact us and we will delete it.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit, access to each user's data is restricted at the database level, and your sign-in session is stored in your device's secure storage. No system is perfectly secure, so please use a strong, unique password.</p>

      <h2>Changes</h2>
      <p>If we change this policy we will update the date above and, for significant changes, let you know in the app.</p>

      <h2>Contact</h2>
      <p>Questions or requests: ${contactHtml()}.</p>
    `,
  });
}

export function renderTermsHtml(): string {
  return legalShell({
    title: "Terms of Use",
    body: `
      <p>These terms are an agreement between you and Fit Pixel ("we", "us") for your use of the Fit Pixel app and services. By creating an account or using Fit Pixel, you agree to them and to our <a href="/privacy">Privacy Policy</a>.</p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 years old. If you are under the age of majority where you live, you need a parent or guardian's permission.</li>
        <li>Keep your password secure. You are responsible for activity on your account.</li>
        <li>Give accurate sign-up information and don't impersonate anyone.</li>
      </ul>

      <h2>Community rules — zero tolerance</h2>
      <p>Fit Pixel has gym chats, direct messages and public profiles. <strong>We have zero tolerance for objectionable content or abusive users.</strong> You may not post or send content that:</p>
      <ul>
        <li>harasses, bullies, threatens or intimidates anyone;</li>
        <li>is hateful or discriminatory toward any person or group;</li>
        <li>is sexually explicit, or sexualizes minors in any way;</li>
        <li>promotes violence, self-harm, eating disorders or illegal activity;</li>
        <li>is spam, scams, or unsolicited advertising;</li>
        <li>shares someone else's personal information without permission.</li>
      </ul>
      <p>Messages, display names and bios are automatically filtered: hateful, sexual and threatening content is blocked before anyone sees it, and mild swearing is masked. You can report any message or user and block anyone from their profile or chat. We review reports and aim to act within 24 hours, which can include removing content and suspending or permanently banning the account responsible.</p>

      <h2>Your content</h2>
      <p>You own what you post. You give us a limited licence to store, display and deliver it to provide the service (for example, showing your messages to the people in a chat). We may remove content that breaks these terms.</p>

      <h2>Health disclaimer</h2>
      <p>Fit Pixel is a habit tracker and game, not a medical device. It does not provide medical, nutritional or fitness advice. Nutrition information comes from third-party databases and may be inaccurate. Talk to a qualified professional before starting a diet or exercise program, and stop exercising if you feel pain or discomfort.</p>

      <h2>Virtual items</h2>
      <p>XP, levels and Pixel items have no monetary value, can't be exchanged for money, and may change as we develop the game.</p>

      <h2>Acceptable use</h2>
      <p>Don't misuse the service: no attempts to access other users' data, bypass security or rate limits, scrape, reverse engineer, or disrupt Fit Pixel.</p>

      <h2>Ending your use</h2>
      <p>You can delete your account at any time in Settings. We may suspend or terminate accounts that break these terms or put other users at risk.</p>

      <h2>Disclaimers and liability</h2>
      <p>Fit Pixel is provided "as is" without warranties of any kind. To the extent permitted by law, we are not liable for indirect or consequential damages, or for lost data, arising from your use of the service. Nothing in these terms limits rights you have under consumer protection law that can't be waived.</p>

      <h2>Apple</h2>
      <p>These terms are between you and Fit Pixel, not Apple. Apple is not responsible for the app or its content, has no obligation to provide support for it, and is a third-party beneficiary of these terms with the right to enforce them against you.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of British Columbia and the federal laws of Canada that apply there.</p>

      <h2>Changes</h2>
      <p>We may update these terms. We will change the date above and, for significant changes, let you know in the app. Continuing to use Fit Pixel means you accept the updated terms.</p>

      <h2>Contact</h2>
      <p>${contactHtml()}</p>
    `,
  });
}

export function renderSupportHtml(): string {
  return legalShell({
    title: "Support",
    showEffectiveDate: false,
    body: `
      <p>Questions, bugs or feedback? Email ${contactHtml()} and include the email address you signed up with. We aim to reply within two business days.</p>

      <h2>Your account</h2>
      <ul>
        <li><strong>Forgot your password:</strong> on the sign-in screen, tap <strong>Forgot password?</strong> and follow the emailed link.</li>
        <li><strong>Delete your account:</strong> in the app, go to <strong>Settings → Account info → Delete account</strong>. This permanently removes your account and the data stored on our servers.</li>
      </ul>

      <h2>Apple Health</h2>
      <p>Fit Pixel only reads from Apple Health and never writes to it. To change what it can read, open the iPhone <strong>Settings</strong> app → <strong>Health</strong> → <strong>Data Access &amp; Devices</strong> → <strong>Fit Pixel</strong>. You can check what's connected in the app under <strong>Settings → Health &amp; wearables</strong>.</p>

      <h2>Safety in chat</h2>
      <ul>
        <li><strong>Report or block:</strong> press and hold a message from another Pixel, then choose <strong>Report message</strong> or <strong>Block</strong>.</li>
        <li><strong>Unblock:</strong> go to <strong>Settings → Blocked Pixels</strong>.</li>
        <li>For anything urgent or a safety concern, email ${contactHtml()}.</li>
      </ul>
    `,
  });
}

export const legalRouter = Router();

legalRouter.get("/privacy", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.type("html").send(renderPrivacyPolicyHtml());
});

legalRouter.get("/terms", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.type("html").send(renderTermsHtml());
});

legalRouter.get("/support", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.type("html").send(renderSupportHtml());
});
