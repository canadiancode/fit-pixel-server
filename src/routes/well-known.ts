import { Router } from "express";

import { renderAuthCallbackHtml } from "./auth-callback-html";

/**
 * HTTPS Universal Links / App Links stubs.
 * Do not enable magic-link or third-party OAuth until these are real
 * (Apple Team ID + Android SHA-256) and associated domains are live.
 *
 * GET /auth/callback is the password-reset landing page (anon key in the
 * HTML only — never the service role). Recovery tokens stay in the browser.
 */

const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "TEAMID.com.fitpixel.app",
        paths: ["/auth/callback", "/auth/callback/*"],
      },
    ],
  },
};

const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.fitpixel.app",
      sha256_cert_fingerprints: [
        "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
      ],
    },
  },
];

export const wellKnownRouter = Router();

wellKnownRouter.get(
  "/.well-known/apple-app-site-association",
  (_req, res) => {
    res.type("application/json").json(AASA);
  },
);

wellKnownRouter.get("/apple-app-site-association", (_req, res) => {
  res.type("application/json").json(AASA);
});

wellKnownRouter.get("/.well-known/assetlinks.json", (_req, res) => {
  res.type("application/json").json(ASSET_LINKS);
});

wellKnownRouter.get("/auth/callback", (_req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.type("html").send(renderAuthCallbackHtml());
});
