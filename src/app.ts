import path from "node:path";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { createCorsMiddleware } from "./middleware/cors";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { ipRateLimit } from "./middleware/rate-limit";
import { blocksRouter } from "./routes/blocks";
import { dmsRouter } from "./routes/dms";
import { foodRouter } from "./routes/food";
import { friendsRouter } from "./routes/friends";
import { gymSubmissionsRouter } from "./routes/gym-submissions";
import { gymsRouter } from "./routes/gyms";
import { habitsRouter } from "./routes/habits";
import { healthRouter } from "./routes/health";
import { leaderboardRouter } from "./routes/leaderboard";
import { legalRouter } from "./routes/legal-html";
import { meRouter } from "./routes/me";
import { notificationsRouter } from "./routes/notifications";
import { pixelsRouter } from "./routes/pixels";
import { pushTokensRouter } from "./routes/push-tokens";
import { reportsRouter } from "./routes/reports";
import { syncRouter } from "./routes/sync";
import { wellKnownRouter } from "./routes/well-known";
import { workoutsRouter } from "./routes/workouts";

const AUTH_ASSETS_DIR = path.join(__dirname, "..", "public", "auth");

export function createApp() {
  const app = express();

  // One hop: nginx. Required for Helmet HSTS and X-Forwarded-Proto.
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(createCorsMiddleware());
  app.use(ipRateLimit);
  app.use(express.json({ limit: "1mb" }));
  app.use(
    morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
      skip: () => env.NODE_ENV === "test",
    }),
  );

  app.use(
    "/auth/assets",
    express.static(AUTH_ASSETS_DIR, {
      index: false,
      maxAge: "7d",
      // Public brand files that the auth emails load from other origins
      // (mail clients, webmail). Helmet's default same-origin CORP would
      // block them there; the font also needs CORS for @font-face.
      setHeaders(res) {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
      },
    }),
  );
  app.use(wellKnownRouter);
  app.use(healthRouter);
  app.use(legalRouter);
  app.use("/v1/sync", syncRouter);
  app.use("/v1/me", meRouter);
  app.use("/v1/habits", habitsRouter);
  app.use("/v1/workouts", workoutsRouter);
  app.use("/v1/food", foodRouter);
  app.use("/v1/gyms", gymsRouter);
  app.use("/v1/gym-submissions", gymSubmissionsRouter);
  app.use("/v1/dms", dmsRouter);
  app.use("/v1/pixels", pixelsRouter);
  app.use("/v1/blocks", blocksRouter);
  app.use("/v1/reports", reportsRouter);
  app.use("/v1/friends", friendsRouter);
  app.use("/v1/leaderboard", leaderboardRouter);
  app.use("/v1/notifications", notificationsRouter);
  app.use("/v1/push-tokens", pushTokensRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

