// All tunables in one place; env overrides so the container needs no rebuild.
module.exports = {
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',   // password for /admin, /host, /api/admin, /api/upload; '' = locked (503)
  PORT: Number(process.env.PORT) || 3000,
  TZ: process.env.TZ || 'Europe/Berlin',
  DB_PATH: 'data/game.db',
  UPLOADS_DIR: 'data/uploads',
};
