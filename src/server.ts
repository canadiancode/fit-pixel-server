import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(
    `Fit Pixel API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});
