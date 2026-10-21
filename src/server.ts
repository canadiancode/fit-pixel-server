import { createApp } from "./app";
import { env } from "./config/env";

// Log anything that escapes the Express error handler. An uncaught exception
// leaves the process in an unknown state, so exit and let PM2 restart it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

const app = createApp();

app.listen(env.PORT, env.HOST, () => {
  console.log(
    `Fit Pixel API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`,
  );
});
