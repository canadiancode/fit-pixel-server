import cors from "cors";
import { env, parseCorsOrigins } from "../config/env";

export function createCorsMiddleware() {
  const origins = parseCorsOrigins(env.CORS_ORIGINS);

  if (origins === "*") {
    return cors({ origin: true, credentials: true });
  }

  return cors({
    origin(origin, callback) {
      // Allow non-browser clients (Expo / curl) with no Origin header
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  });
}
