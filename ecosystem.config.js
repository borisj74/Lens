// PM2 process definition for the Lens server.
// Run with: npm run start:daemon  (alias for `pm2 start ecosystem.config.js`)
// The daemon survives crashes and terminal closes and auto-restarts on failure.
module.exports = {
  apps: [
    {
      name: 'lens',
      script: 'server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 1000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 4567,
      },
    },
  ],
};
