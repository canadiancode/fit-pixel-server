import path from "node:path";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { createCorsMiddleware } from "./middleware/cors";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { dmsRouter } from "./routes/dms";
import { foodRouter } from "./routes/food";
import { gymsRouter } from "./routes/gyms";
import { habitsRouter } from "./routes/habits";
import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { pixelsRouter } from "./routes/pixels";
import { syncRouter } from "./routes/sync";
import { wellKnownRouter } from "./routes/well-known";

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
    }),
  );
  app.use(wellKnownRouter);
  app.use(healthRouter);
  app.use("/v1/sync", syncRouter);
  app.use("/v1/me", meRouter);
  app.use("/v1/habits", habitsRouter);
  app.use("/v1/food", foodRouter);
  app.use("/v1/gyms", gymsRouter);
  app.use("/v1/dms", dmsRouter);
  app.use("/v1/pixels", pixelsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

