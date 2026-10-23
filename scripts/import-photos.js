#!/usr/bin/env node
// One-off for the move from maptap-scoreboard: copy the photos that rounds
// reference out of another uploads folder. Safe to re-run (skips files already here).
// Usage: node scripts/import-photos.js <src-uploads-dir> [db=data/game.db] [dest=data/uploads]
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const [src, dbPath = 'data/game.db', dest = 'data/uploads'] = process.argv.slice(2);
if (!src) { console.error('usage: node scripts/import-photos.js <src-uploads-dir> [db] [dest]'); process.exit(2); }

const db = new Database(dbPath, { readonly: true });
const files = db.prepare('SELECT DISTINCT photo FROM rounds WHERE photo IS NOT NULL').all().map((r) => r.photo);
fs.mkdirSync(dest, { recursive: true });
let copied = 0, present = 0;
const missing = [];
for (const f of files) {
  const from = path.join(src, f), to = path.join(dest, f);
  if (fs.existsSync(to)) { present++; continue; }
  if (!fs.existsSync(from)) { missing.push(f); continue; }
  fs.copyFileSync(from, to);
  copied++;
}
console.log(`${files.length} referenced, ${copied} copied, ${present} already present, ${missing.length} missing${missing.length ? ': ' + missing.join(' ') : ''}`);
process.exit(missing.length ? 1 : 0);
