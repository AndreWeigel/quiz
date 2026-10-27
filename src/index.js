// The quiz app: health check, public photos, the admin-only upload endpoint,
// and the game router mounted at the root. Nothing else lives on this domain.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { basicAuth } = require('./auth');
const gameRoutes = require('./routes');

const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function createApp({ dbPath = config.DB_PATH, uploadsDir = config.UPLOADS_DIR } = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' })); // pasted shapes are capped at 1 MB

  // Before the game router: its /:slug catch-all would answer this with a 404.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  // No landing page: the bare domain is only ever typed by the game builder.
  app.get('/', (_req, res) => res.redirect('/admin'));

  // Photos are public. Names are 16 random hex chars that only ever appear on a
  // reveal, so a photo is as discoverable as the game link itself — no more.
  app.use('/uploads', express.static(uploadsDir, { maxAge: '365d', immutable: true }));

  // Random server-side names; client names never used. Before the router so
  // /api/:slug can't shadow it.
  app.post('/api/upload', basicAuth, express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
    const ext = IMG_EXT[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'jpeg/png/webp/gif only' });
    }
    const file = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, file), req.body);
    res.json({ file });
  });

  app.use('/', gameRoutes({ basicAuth, dbPath, uploadsDir }));
  return app;
}

if (require.main === module) {
  process.env.TZ = config.TZ;
  createApp().listen(config.PORT, () => console.log(`[quiz] listening on http://localhost:${config.PORT}`));
}

module.exports = { createApp };
