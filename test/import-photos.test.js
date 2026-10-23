const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { openGameDb } = require('../src/db');

test('import-photos copies the photos rounds reference, skips present ones, reports missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'));
  try {
    const src = path.join(dir, 'src'), dest = path.join(dir, 'dest'), dbPath = path.join(dir, 'game.db');
    fs.mkdirSync(src); fs.mkdirSync(dest);
    fs.writeFileSync(path.join(src, 'aaaaaaaaaaaaaaaa.jpg'), 'A');
    fs.writeFileSync(path.join(src, 'bbbbbbbbbbbbbbbb.png'), 'B');
    fs.writeFileSync(path.join(dest, 'bbbbbbbbbbbbbbbb.png'), 'B-already');
    const db = openGameDb(dbPath);
    const g = db.createGame('t');
    db.saveGame(g.id, 't', [
      { question: 'a', lat: 1, lng: 1, photo: 'aaaaaaaaaaaaaaaa.jpg' },
      { question: 'b', lat: 1, lng: 1, photo: 'bbbbbbbbbbbbbbbb.png' },
      { question: 'c', lat: 1, lng: 1, photo: 'cccccccccccccccc.gif' },
      { question: 'd', lat: 1, lng: 1 },
    ]);
    db.raw.close();
    let out, status = 0;
    try { out = execFileSync(process.execPath, ['scripts/import-photos.js', src, dbPath, dest], { encoding: 'utf8' }); }
    catch (e) { out = e.stdout; status = e.status; }
    assert.equal(status, 1); // one missing
    assert.match(out, /3 referenced, 1 copied, 1 already present, 1 missing: cccccccccccccccc\.gif/);
    assert.equal(fs.readFileSync(path.join(dest, 'aaaaaaaaaaaaaaaa.jpg'), 'utf8'), 'A');
    assert.equal(fs.readFileSync(path.join(dest, 'bbbbbbbbbbbbbbbb.png'), 'utf8'), 'B-already');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
