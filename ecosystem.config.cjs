/** PM2 process file for production on DigitalOcean. */
module.exports = {
  apps: [
    {
      name: "fit-pixel-api",
      script: "dist/server.js",
      cwd: "/var/www/fit-pixel-server",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
