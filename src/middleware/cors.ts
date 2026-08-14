import cors from "cors";
import { env, parseCorsOrigins } from "../config/env";

export function createCorsMiddleware() {
  const origins = parseCorsOrigins(env.CORS_ORIGINS);

  // Empty or *: no browser CORS. Native Expo / curl (no Origin) still work.
  if (origins.length === 0) {
    return cors({ origin: false });
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
