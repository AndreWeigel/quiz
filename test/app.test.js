process.env.ADMIN_TOKEN = 's3cret'; // before config loads
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/index');

const auth = { authorization: 'Basic ' + Buffer.from('admin:s3cret').toString('base64') };

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-'));
  const app = createApp({ dbPath: ':memory:', uploadsDir: path.join(dir, 'uploads') });
  const server = app.listen(0);
  try { return await fn(`http://127.0.0.1:${server.address().port}`, dir); }
  finally { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('healthz answers before the /:slug catch-all', async () => {
  await withApp(async (base) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });
});

test('admin pages and upload need the password; photos do not', async () => {
  await withApp(async (base, dir) => {
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    assert.equal((await fetch(`${base}/admin`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' })).status, 401);
    const bad = await fetch(`${base}/api/upload`, { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(bad.status, 400);
    const up = await fetch(`${base}/api/upload`, { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: Buffer.from('fakepng') });
    assert.equal(up.status, 200);
    const { file } = await up.json();
    assert.match(file, /^[a-f0-9]{16}\.png$/);
    assert.ok(fs.existsSync(path.join(dir, 'uploads', file)));
    const got = await fetch(`${base}/uploads/${file}`);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), 'fakepng');
  });
});

test('unknown slugs still 404 at the root', async () => {
  await withApp(async (base) => {
    const r = await fetch(`${base}/deadbeefdeadbeef`);
    assert.equal(r.status, 404);
    assert.equal(await r.text(), 'No such game.');
  });
});
