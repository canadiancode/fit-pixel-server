import { Router } from "express";

/**
 * HTTPS Universal Links / App Links stubs.
 * Do not enable magic-link or third-party OAuth until these are real
 * (Apple Team ID + Android SHA-256) and associated domains are live.
 */

const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "TEAMID.com.onerepmax.app",
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
      package_name: "com.onerepmax.app",
      sha256_cert_fingerprints: [
        "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
      ],
    },
  },
];

const CALLBACK_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fit Pixel</title>
  </head>
  <body>
    <p>Return to the Fit Pixel app to continue.</p>
    <p>Password reset and OAuth are not enabled on the custom URL scheme alone.</p>
  </body>
</html>`;

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
  res.type("html").send(CALLBACK_HTML);
});
