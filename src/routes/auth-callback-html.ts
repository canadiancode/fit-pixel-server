import { env, getSupabaseUrl } from "../config/env";

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** Custom scheme from the Expo app (`app.json` → `scheme`). */
const APP_OPEN_URL = "fitpixel://";

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Card layout matching the app's sign-in screen: navy shell, pixel font for
 * headings / labels / buttons, system font for sentences so they stay legible.
 */
function pageShell(opts: {
  title: string;
  connectSrc?: string;
  body: string;
}): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self'",
    opts.connectSrc ? `connect-src ${opts.connectSrc}` : null,
    "base-uri 'none'",
    "form-action 'self'",
    // frame-ancestors is ignored in <meta>; Helmet's X-Frame-Options covers framing.
  ]
    .filter(Boolean)
    .join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#02284f" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${opts.title}</title>
    <link rel="icon" type="image/png" href="/auth/assets/favicon.png" />
    <style>
      @font-face {
        font-family: "PressStart2P";
        src: url("/auth/assets/PressStart2P-Regular.ttf") format("truetype");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      :root {
        color-scheme: dark;
        --frame: #03418c;
        --bg: #02284f;
        --bg-deep: #011a35;
        --text: #ffffff;
        --muted: #ffffffb8;
        --placeholder: rgba(255, 255, 255, 0.45);
        --error: #ff8a8a;
        --success: #8be28b;
        --focus: #7cc8ff;
        --pixel: "PressStart2P", ui-monospace, monospace;
        --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        min-height: 100vh;
        min-height: 100dvh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        background:
          radial-gradient(ellipse at top, rgba(3, 65, 140, 0.55), transparent 60%),
          var(--bg-deep);
        color: var(--text);
        font-family: var(--sans);
        -webkit-font-smoothing: antialiased;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: var(--bg);
        border: 4px solid var(--frame);
        border-radius: 16px;
        padding: 32px 24px 28px;
        box-shadow: 0 0 0 4px var(--bg-deep), 0 24px 60px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .brand img {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        image-rendering: pixelated;
      }
      .brand span {
        font-family: var(--pixel);
        font-size: 14px;
        line-height: 20px;
        letter-spacing: 0.5px;
      }
      .intro { display: grid; gap: 10px; }
      h1 {
        margin: 0;
        font-family: var(--pixel);
        font-size: 18px;
        line-height: 28px;
        font-weight: 400;
      }
      p {
        margin: 0;
        font-size: 15px;
        line-height: 22px;
        color: var(--muted);
      }
      form { display: grid; gap: 16px; margin: 0; }
      .field { display: grid; gap: 8px; }
      .field-label {
        font-family: var(--pixel);
        font-size: 10px;
        line-height: 14px;
        color: var(--muted);
      }
      .field-shell {
        position: relative;
        height: 52px;
        border-radius: 12px;
        overflow: hidden;
      }
      .field-shell:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
      .field-shell img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: fill;
        pointer-events: none;
      }
      .field-shell input {
        position: relative;
        z-index: 1;
        width: 100%;
        height: 52px;
        margin: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text);
        font-family: var(--sans);
        font-size: 16px;
        padding: 0 18px;
      }
      .field-shell input::placeholder { color: var(--placeholder); }
      .show {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        color: var(--muted);
        cursor: pointer;
        user-select: none;
      }
      .show input { width: 18px; height: 18px; margin: 0; accent-color: var(--focus); }
      .btn {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 52px;
        padding: 14px 16px;
        border: 0;
        border-radius: 8px;
        overflow: hidden;
        background: transparent;
        color: var(--text);
        font-family: var(--pixel);
        font-size: 12px;
        line-height: 16px;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
      }
      .btn img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: fill;
        pointer-events: none;
        image-rendering: pixelated;
      }
      .btn span { position: relative; z-index: 1; }
      .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
      .btn:hover:not(:disabled) { filter: brightness(1.08); }
      .btn:active:not(:disabled) { opacity: 0.88; }
      .btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .message { font-size: 14px; line-height: 20px; }
      .message.error { color: var(--error); }
      .message.success { color: var(--success); }
      .footer {
        margin: 4px 0 0;
        padding-top: 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.55);
      }
      [hidden] { display: none !important; }
      @media (max-width: 380px) {
        .card { padding: 24px 18px 22px; }
        h1 { font-size: 16px; line-height: 24px; }
      }
      @media (prefers-reduced-motion: no-preference) {
        .card { animation: rise 240ms ease-out; }
        @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand">
        <img src="/auth/assets/app-icon.png" alt="" width="48" height="48" />
        <span>Fit Pixel</span>
      </div>
      ${opts.body}
    </main>
  </body>
</html>`;
}

function inputField(opts: {
  id: string;
  label: string;
  placeholder: string;
}): string {
  return `<div class="field">
          <label class="field-label" for="${opts.id}">${opts.label}</label>
          <div class="field-shell">
            <img src="/auth/assets/text-input-long.png" alt="" />
            <input id="${opts.id}" name="${opts.id}" type="password" autocomplete="new-password"
              placeholder="${opts.placeholder}"
              minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required />
          </div>
        </div>`;
}

function primaryButton(opts: {
  id: string;
  label: string;
  type?: "submit";
  href?: string;
  hidden?: boolean;
}): string {
  const inner = `<img src="/auth/assets/button-primary.png" alt="" /><span>${opts.label}</span>`;
  const hidden = opts.hidden ? " hidden" : "";
  if (opts.href) {
    return `<a id="${opts.id}" class="btn" href="${opts.href}"${hidden}>${inner}</a>`;
  }
  return `<button id="${opts.id}" class="btn" type="${opts.type ?? "submit"}"${hidden}>${inner}</button>`;
}

export function renderAuthCallbackHtml(): string {
  const url = getSupabaseUrl();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return pageShell({
      title: "Fit Pixel",
      body: `<div class="intro">
        <h1>Reset unavailable</h1>
        <p>This reset page isn't available right now. Request a new reset link from the Fit Pixel app later.</p>
      </div>`,
    });
  }

  const configJson = jsonForScript({
    url,
    anonKey,
    passwordMin: PASSWORD_MIN,
    passwordMax: PASSWORD_MAX,
  });

  const body = `<div class="intro">
        <h1 id="title">Reset password</h1>
        <p id="status" role="status" aria-live="polite">Checking your reset link…</p>
      </div>
      <noscript><p class="message error">Turn on JavaScript to reset your password.</p></noscript>
      <form id="form" hidden novalidate>
        ${inputField({
          id: "password",
          label: "New password",
          placeholder: `At least ${PASSWORD_MIN} characters`,
        })}
        ${inputField({
          id: "confirm",
          label: "Confirm password",
          placeholder: "Type it again",
        })}
        <label class="show"><input id="show" type="checkbox" /> Show passwords</label>
        <p id="message" class="message error" role="alert" hidden></p>
        ${primaryButton({ id: "submit", label: "Save new password" })}
      </form>
      ${primaryButton({ id: "open-app", label: "Open Fit Pixel", href: APP_OPEN_URL, hidden: true })}
      <p id="footer" class="footer">Link not working? Request a new one from the Fit Pixel sign-in screen with “Forgot password?”.</p>
    <script>
      const CONFIG = ${configJson};
      const titleEl = document.getElementById("title");
      const statusEl = document.getElementById("status");
      const formEl = document.getElementById("form");
      const messageEl = document.getElementById("message");
      const passwordEl = document.getElementById("password");
      const confirmEl = document.getElementById("confirm");
      const showEl = document.getElementById("show");
      const submitEl = document.getElementById("submit");
      const openAppEl = document.getElementById("open-app");
      const submitLabelEl = submitEl.querySelector("span");
      const EXPIRED = "This link is invalid or has expired. Request a new reset link from the Fit Pixel app.";

      function showMessage(text) {
        messageEl.hidden = false;
        messageEl.textContent = text;
      }

      function fail(text) {
        titleEl.textContent = "Link expired";
        statusEl.textContent = text;
        // The status already says how to get a new link.
        document.getElementById("footer").hidden = true;
      }

      function copyForStatus(res) {
        if (res.status === 429) return "Too many attempts. Try again in a few minutes.";
        if (res.status === 422) return "Use at least " + CONFIG.passwordMin + " characters.";
        if (res.status === 0) return "Could not reach the server. Check your connection.";
        return EXPIRED;
      }

      async function parseJson(res) {
        try { return await res.json(); } catch { return null; }
      }

      async function gotrue(path, opts) {
        const headers = {
          apikey: CONFIG.anonKey,
          Authorization: "Bearer " + (opts.accessToken || CONFIG.anonKey),
        };
        if (opts.body !== undefined) {
          headers["Content-Type"] = "application/json";
        }
        try {
          return await fetch(CONFIG.url + path, {
            method: opts.method,
            headers: headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          });
        } catch {
          return { ok: false, status: 0, json: async function() { return null; } };
        }
      }

      function takeParams() {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const query = new URLSearchParams(window.location.search);
        const params = {
          accessToken: hash.get("access_token") || "",
          refreshToken: hash.get("refresh_token") || "",
          type: (query.get("type") || hash.get("type") || "").toLowerCase(),
          tokenHash: query.get("token_hash") || hash.get("token_hash") || "",
          code: query.get("code") || "",
        };
        history.replaceState(null, "", window.location.pathname);
        return params;
      }

      async function recoverAccessToken(params) {
        if (params.tokenHash) {
          const res = await gotrue("/auth/v1/verify", {
            method: "POST",
            body: { type: params.type || "recovery", token_hash: params.tokenHash },
          });
          const body = await parseJson(res);
          if (!res.ok || !body || !body.access_token) {
            throw new Error(copyForStatus(res));
          }
          return { accessToken: body.access_token, type: params.type || "recovery" };
        }
        if (params.accessToken) {
          return { accessToken: params.accessToken, type: params.type || "recovery" };
        }
        throw new Error(EXPIRED);
      }

      async function logout(accessToken) {
        await gotrue("/auth/v1/logout?scope=local", { method: "POST", accessToken: accessToken });
      }

      showEl.addEventListener("change", function () {
        const type = showEl.checked ? "text" : "password";
        passwordEl.type = type;
        confirmEl.type = type;
      });

      (async function boot() {
        let recovered;
        try {
          recovered = await recoverAccessToken(takeParams());
        } catch (err) {
          fail(err instanceof Error ? err.message : EXPIRED);
          return;
        }

        if (recovered.type && recovered.type !== "recovery") {
          titleEl.textContent = "You're all set";
          statusEl.textContent = "Open the Fit Pixel app to continue.";
          openAppEl.hidden = false;
          await logout(recovered.accessToken);
          return;
        }

        statusEl.textContent = "Choose a new password for your Fit Pixel account.";
        formEl.hidden = false;
        passwordEl.focus();

        formEl.addEventListener("submit", async function (event) {
          event.preventDefault();
          const password = passwordEl.value;
          const confirm = confirmEl.value;
          messageEl.hidden = true;
          if (password.length < CONFIG.passwordMin) {
            showMessage("Use at least " + CONFIG.passwordMin + " characters.");
            passwordEl.focus();
            return;
          }
          if (password.length > CONFIG.passwordMax) {
            showMessage("Use at most " + CONFIG.passwordMax + " characters.");
            passwordEl.focus();
            return;
          }
          if (password !== confirm) {
            showMessage("Passwords don't match.");
            confirmEl.focus();
            return;
          }
          submitEl.disabled = true;
          submitLabelEl.textContent = "Saving…";
          const res = await gotrue("/auth/v1/user", {
            method: "PUT",
            accessToken: recovered.accessToken,
            body: { password: password },
          });
          if (!res.ok) {
            submitEl.disabled = false;
            submitLabelEl.textContent = "Save new password";
            const body = await parseJson(res);
            const code = body && body.msg ? String(body.msg) : "";
            if (/weak|password/i.test(code) || res.status === 422) {
              showMessage("Use at least " + CONFIG.passwordMin + " characters.");
            } else {
              showMessage(copyForStatus(res));
            }
            return;
          }
          passwordEl.value = "";
          confirmEl.value = "";
          await logout(recovered.accessToken);
          formEl.hidden = true;
          titleEl.textContent = "Password updated";
          statusEl.textContent = "Open Fit Pixel and sign in with your new password.";
          openAppEl.hidden = false;
        });
      })();
    </script>`;

  return pageShell({
    title: "Reset password — Fit Pixel",
    connectSrc: url,
    body,
  });
}
