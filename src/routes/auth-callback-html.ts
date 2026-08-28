import { env, getSupabaseUrl } from "../config/env";

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

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
    "frame-ancestors 'none'",
  ]
    .filter(Boolean)
    .join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${opts.title}</title>
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
        --text: #ffffff;
        --muted: #ffffffb8;
        --placeholder: rgba(255, 255, 255, 0.45);
        --cta-border: rgba(120, 200, 255, 0.55);
        --cta-fill: rgba(120, 200, 255, 0.12);
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        min-height: 100vh;
        background: var(--frame);
        color: var(--text);
        font-family: "PressStart2P", system-ui, sans-serif;
        padding: 4px;
      }
      .shell {
        min-height: calc(100vh - 8px);
        background: var(--bg);
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 28px 20px;
        gap: 18px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
        line-height: 30px;
        font-weight: 400;
        color: var(--text);
      }
      p {
        margin: 0;
        font-size: 13px;
        line-height: 18px;
        color: var(--muted);
      }
      form {
        display: grid;
        gap: 18px;
        margin: 0;
      }
      .field { display: grid; gap: 6px; }
      .field-label {
        font-size: 12px;
        line-height: 16px;
        color: var(--muted);
      }
      .field-shell {
        position: relative;
        height: 52px;
        border-radius: 12px;
        overflow: hidden;
      }
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
        font-family: inherit;
        font-size: 14px;
        padding: 0 18px;
      }
      .field-shell input::placeholder { color: var(--placeholder); }
      button.primary {
        margin-top: 8px;
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--cta-border);
        background: var(--cta-fill);
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        line-height: 20px;
        font-weight: 600;
        padding: 14px 16px;
        cursor: pointer;
      }
      button.primary:active:not(:disabled) { opacity: 0.88; }
      button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
      .error { color: var(--muted); }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    ${opts.body}
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

export function renderAuthCallbackHtml(): string {
  const url = getSupabaseUrl();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return pageShell({
      title: "Fit Pixel",
      body: `<div class="shell">
        <h1>Fit Pixel</h1>
        <p>This reset page is not available right now. Request a new reset in the Fit Pixel app later.</p>
      </div>`,
    });
  }

  const configJson = jsonForScript({
    url,
    anonKey,
    passwordMin: PASSWORD_MIN,
    passwordMax: PASSWORD_MAX,
  });

  const body = `<div class="shell">
      <h1>Reset password</h1>
      <p id="status">Checking reset link…</p>
      <form id="form" hidden>
        ${inputField({
          id: "password",
          label: "New password",
          placeholder: "At least 8 characters",
        })}
        ${inputField({
          id: "confirm",
          label: "Confirm password",
          placeholder: "At least 8 characters",
        })}
        <button id="submit" class="primary" type="submit">Save new password</button>
      </form>
      <p id="message" hidden></p>
    </div>
    <script>
      const CONFIG = ${configJson};
      const statusEl = document.getElementById("status");
      const formEl = document.getElementById("form");
      const messageEl = document.getElementById("message");
      const passwordEl = document.getElementById("password");
      const confirmEl = document.getElementById("confirm");
      const submitEl = document.getElementById("submit");

      function showMessage(text) {
        messageEl.hidden = false;
        messageEl.textContent = text;
      }

      function copyForStatus(res) {
        if (res.status === 429) return "Too many attempts. Try again in a few minutes.";
        if (res.status === 422) return "Use at least " + CONFIG.passwordMin + " characters.";
        if (res.status === 0) return "Could not reach the server. Check your connection.";
        return "This link is invalid or expired. Request a new reset in the Fit Pixel app.";
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
        throw new Error("This link is invalid or expired. Request a new reset in the Fit Pixel app.");
      }

      async function logout(accessToken) {
        await gotrue("/auth/v1/logout?scope=local", { method: "POST", accessToken: accessToken });
      }

      (async function boot() {
        let recovered;
        try {
          recovered = await recoverAccessToken(takeParams());
        } catch (err) {
          statusEl.textContent = err instanceof Error ? err.message
            : "This link is invalid or expired. Request a new reset in the Fit Pixel app.";
          return;
        }

        if (recovered.type && recovered.type !== "recovery") {
          statusEl.textContent = "Open the Fit Pixel app to continue.";
          await logout(recovered.accessToken);
          return;
        }

        statusEl.textContent = "Choose a new password, then open Fit Pixel and sign in.";
        formEl.hidden = false;

        formEl.addEventListener("submit", async function (event) {
          event.preventDefault();
          const password = passwordEl.value;
          const confirm = confirmEl.value;
          messageEl.hidden = true;
          if (password.length < CONFIG.passwordMin) {
            showMessage("Use at least " + CONFIG.passwordMin + " characters.");
            return;
          }
          if (password !== confirm) {
            showMessage("Passwords do not match.");
            return;
          }
          submitEl.disabled = true;
          const res = await gotrue("/auth/v1/user", {
            method: "PUT",
            accessToken: recovered.accessToken,
            body: { password: password },
          });
          passwordEl.value = "";
          confirmEl.value = "";
          if (!res.ok) {
            submitEl.disabled = false;
            const body = await parseJson(res);
            const code = body && body.msg ? String(body.msg) : "";
            if (/weak|password/i.test(code) || res.status === 422) {
              showMessage("Use at least " + CONFIG.passwordMin + " characters.");
            } else {
              showMessage(copyForStatus(res));
            }
            return;
          }
          await logout(recovered.accessToken);
          formEl.hidden = true;
          statusEl.textContent = "Password updated. Open Fit Pixel and sign in with your new password.";
        });
      })();
    </script>`;

  return pageShell({
    title: "Reset password — Fit Pixel",
    connectSrc: url,
    body,
  });
}
