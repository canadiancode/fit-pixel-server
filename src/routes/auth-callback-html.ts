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
      :root {
        color-scheme: dark;
        --bg: #02284f;
        --frame: #03418c;
        --text: #ffffff;
        --muted: rgba(255, 255, 255, 0.72);
        --border: rgba(120, 200, 255, 0.55);
        --fill: rgba(120, 200, 255, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, sans-serif;
        background: var(--frame);
        color: var(--text);
      }
      main {
        max-width: 28rem;
        margin: 0 auto;
        min-height: 100vh;
        padding: 2.5rem 1.25rem;
        background: var(--bg);
      }
      h1 { font-size: 1.35rem; line-height: 1.3; margin: 0 0 1rem; }
      p, label { font-size: 1rem; line-height: 1.45; color: var(--muted); }
      form { display: grid; gap: 1rem; margin-top: 1.25rem; }
      label { display: grid; gap: 0.4rem; color: var(--muted); font-size: 0.85rem; }
      input {
        width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(0,0,0,0.2);
        color: var(--text);
        padding: 0.85rem 1rem;
        font-size: 1rem;
      }
      button {
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--fill);
        color: var(--text);
        padding: 0.9rem 1rem;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled { opacity: 0.55; cursor: not-allowed; }
      .error { color: #ffb4b4; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    ${opts.body}
  </body>
</html>`;
}

export function renderAuthCallbackHtml(): string {
  const url = getSupabaseUrl();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return pageShell({
      title: "Fit Pixel",
      body: `<main>
        <h1>Fit Pixel</h1>
        <p>This reset page is not available right now. Request a new reset in the Fit Pixel app later.</p>
      </main>`,
    });
  }

  const configJson = jsonForScript({
    url,
    anonKey,
    passwordMin: PASSWORD_MIN,
    passwordMax: PASSWORD_MAX,
  });

  const body = `<main>
      <h1>Fit Pixel</h1>
      <p id="status">Checking reset link…</p>
      <form id="form" hidden>
        <label>
          New password
          <input id="password" name="password" type="password" autocomplete="new-password"
            minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required />
        </label>
        <label>
          Confirm password
          <input id="confirm" name="confirm" type="password" autocomplete="new-password"
            minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required />
        </label>
        <button id="submit" type="submit">Save new password</button>
      </form>
      <p id="message" class="error" hidden></p>
    </main>
    <script>
      const CONFIG = ${configJson};
      const statusEl = document.getElementById("status");
      const formEl = document.getElementById("form");
      const messageEl = document.getElementById("message");
      const passwordEl = document.getElementById("password");
      const confirmEl = document.getElementById("confirm");
      const submitEl = document.getElementById("submit");

      function showMessage(text, isError) {
        messageEl.hidden = false;
        messageEl.textContent = text;
        messageEl.className = isError ? "error" : "";
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
            showMessage("Use at least " + CONFIG.passwordMin + " characters.", true);
            return;
          }
          if (password !== confirm) {
            showMessage("Passwords do not match.", true);
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
              showMessage("Use at least " + CONFIG.passwordMin + " characters.", true);
            } else {
              showMessage(copyForStatus(res), true);
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
