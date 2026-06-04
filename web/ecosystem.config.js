// pm2 process config for the Poker Arena manual-pilot web app.
// Usage on the VPS:
//   cd web
//   cp .env.example .env.local && $EDITOR .env.local   # set APP_PASSWORD
//   npm ci && npm run build
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup   # follow the printed instructions for boot persistence
//
// Logs live in web/logs/. The app listens on 0.0.0.0:3030.

module.exports = {
  apps: [
    {
      name: "poker-arena-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3030",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        // APP_PASSWORD and any ARENA_* overrides are read from web/.env.local.
        // Do NOT put secrets here — this file is committed.
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
