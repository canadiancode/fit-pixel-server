import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { createCorsMiddleware } from "./middleware/cors";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth";
import { foodRouter } from "./routes/food";
import { habitsRouter } from "./routes/habits";
import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { syncRouter } from "./routes/sync";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
      skip: () => env.NODE_ENV === "test",
    }),
  );

  app.use(healthRouter);
  app.use("/v1/auth", authRouter);
  app.use("/v1/sync", syncRouter);
  app.use("/v1/me", meRouter);
  app.use("/v1/habits", habitsRouter);
  app.use("/v1/food", foodRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
