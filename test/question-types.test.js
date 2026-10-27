process.env.ADMIN_TOKEN = 's3cret'; // before config loads, so basicAuth is enabled
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { basicAuth } = require('../src/auth');
const gameRoutes = require('../src/routes');
const { openGameDb } = require('../src/db');
const { textCorrect, numberPoints } = require('../src/scoring');

test('textCorrect: case, accents, punctuation, "the", small typos; digits exact', () => {
  const yes = [['gotard', ['Gotthard']], ['Zurich', ['Zürich']], ['the Gotthard base-tunnel', ['Gotthard Base Tunnel']],
    ['  SHINJUKU ', ['Shinjuku']], ['Vladivostock', ['Vladivostok']], ['Lima', ['Paris', 'Lima']]];
  for (const [g, a] of yes) assert.equal(textCorrect(g, a), true, `${g} ✓ ${a}`);
  const no = [['Paris', ['Lima']], ['1826', ['1825']], ['Rom', ['Oslo']], ['', ['x']], ['the', ['Gotthard']]];
  for (const [g, a] of no) assert.equal(textCorrect(g, a), false, `${g} ✗ ${a}`);
});

test('numberPoints: full within tolerance, halves every `halve` beyond (default 10 % of value)', () => {
  assert.equal(numberPoints(57, { value: 57 }), 100);
  assert.equal(numberPoints(60, { value: 57 }), 69);
  assert.equal(numberPoints(50, { value: 57 }), 43);
  assert.equal(numberPoints(1815, { value: 1825, halve: 10 }), 50);
  assert.equal(numberPoints(1800, { value: 1825, halve: 10 }), 18);
  assert.equal(numberPoints(1822, { value: 1825, tolerance: 3, halve: 10 }), 100);
  assert.equal(numberPoints(2, { value: 0 }), 25); // value 0: halve falls back to 1
});

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/', gameRoutes({ basicAuth, dbPath: ':memory:' }));
  const server = app.listen(0);
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); server.close(); }
}
const auth = { authorization: 'Basic ' + Buffer.from('admin:s3cret').toString('base64') };
const json = { 'content-type': 'application/json' };
const post = (url, body, headers = json) => fetch(url, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });

const MIXED = [
  { question: 'Busiest station?', lat: 35.69, lng: 139.7, radius: 25 },
  { question: 'Longest rail tunnel?', type: 'text', spec: { accept: ['Gotthard Base Tunnel', 'Gotthard'] }, story: 's' },
  { question: 'Most platforms?', type: 'choice', spec: { options: ['Shinjuku', 'Grand Central', 'Paris Nord'], correct: 1 } },
  { question: 'Gotthard length?', type: 'number', spec: { value: 57, unit: 'km' } },
];

async function mixedGame(base) {
  const g = await (await post(`${base}/api/admin/games`, { title: 'Rail' }, { ...auth, ...json })).json();
  const put = await fetch(`${base}/api/admin/games/${g.id}`, { method: 'PUT', headers: { ...auth, ...json },
    body: JSON.stringify({ title: 'Rail', rounds: MIXED }) });
  assert.equal(put.status, 200);
  return { g, saved: await put.json() };
}

test('a mixed game round-trips; the public view never carries the answers', async () => {
  await withServer(async (base) => {
    const { g, saved } = await mixedGame(base);
    assert.deepEqual(saved.rounds.map((r) => r.type), ['location', 'text', 'choice', 'number']);
    assert.deepEqual(saved.rounds[1].spec, { accept: ['Gotthard Base Tunnel', 'Gotthard'] });
    assert.equal(saved.rounds[1].lat, null);
    assert.deepEqual(saved.rounds[3].spec, { value: 57, unit: 'km', tolerance: 0 });
    const pub = await (await fetch(`${base}/api/${g.slug}`)).json();
    assert.deepEqual(pub.rounds, [
      { ord: 0, question: 'Busiest station?', type: 'location' },
      { ord: 1, question: 'Longest rail tunnel?', type: 'text' },
      { ord: 2, question: 'Most platforms?', type: 'choice', options: ['Shinjuku', 'Grand Central', 'Paris Nord'] },
      { ord: 3, question: 'Gotthard length?', type: 'number', unit: 'km' },
    ]);
  });
});

test('PUT rejects malformed type fields with a message and the round index', async () => {
  await withServer(async (base) => {
    const { g } = await mixedGame(base);
    const bad = [
      [{ question: 'q', type: 'text', spec: { accept: ['  '] } }, /typed answer/],
      [{ question: 'q', type: 'choice', spec: { options: ['a'], correct: 0 } }, /multiple choice/],
      [{ question: 'q', type: 'choice', spec: { options: ['a', 'b'], correct: 2 } }, /multiple choice/],
      [{ question: 'q', type: 'number', spec: { value: 'x' } }, /number/],
      [{ question: 'q', type: 'number', spec: { value: 1, halve: 0 } }, /number/],
      [{ question: 'q', type: 'nope' }, /invalid/],
    ];
    for (const [round, msg] of bad) {
      const r = await fetch(`${base}/api/admin/games/${g.id}`, { method: 'PUT', headers: { ...auth, ...json },
        body: JSON.stringify({ title: 'Rail', rounds: [MIXED[0], round] }) });
      assert.equal(r.status, 400, JSON.stringify(round));
      const d = await r.json();
      assert.match(d.error, msg);
      assert.equal(d.round, 1);
    }
  });
});

test('guess per type: score + truth; wrong answer shapes → 400', async () => {
  await withServer(async (base) => {
    const { g } = await mixedGame(base);
    const guess = (body) => post(`${base}/api/${g.slug}/guess`, body);
    let r = await (await guess({ ord: 1, answer: 'gotard' })).json();
    assert.deepEqual([r.points, r.correct, r.truth.answer, r.truth.story], [100, true, 'Gotthard Base Tunnel', 's']);
    r = await (await guess({ ord: 2, answer: 0 })).json();
    assert.deepEqual([r.points, r.correct, r.truth.correct, r.truth.answer], [0, false, 1, 'Grand Central']);
    r = await (await guess({ ord: 3, answer: 60 })).json();
    assert.deepEqual([r.points, r.truth.value, r.truth.unit, r.truth.answer], [69, 57, 'km', '57 km']);
    for (const body of [{ ord: 1, answer: '' }, { ord: 2, answer: 3 }, { ord: 2, answer: '1' }, { ord: 3, answer: 'x' }, { ord: 0, answer: 'x' }]) {
      assert.equal((await guess(body)).status, 400, JSON.stringify(body));
    }
  });
});

test('plays: mixed guesses are rescored server-side', async () => {
  await withServer(async (base) => {
    const { g } = await mixedGame(base);
    const guesses = [{ ord: 0, lat: 35.69, lng: 139.7 }, { ord: 1, answer: 'Simplon' }, { ord: 2, answer: 1 }, { ord: 3, answer: 50 }];
    const d = await (await post(`${base}/api/${g.slug}/plays`, { player_name: 'Ana', guesses })).json();
    assert.deepEqual(d.rounds.map((x) => x.points), [100, 0, 100, 43]);
    assert.equal(d.total, 243);
    const bad = await post(`${base}/api/${g.slug}/plays`, { player_name: 'Bo', guesses: [...guesses.slice(0, 3), { ord: 3, lat: 1, lng: 2 }] });
    assert.equal(bad.status, 400);
  });
});

test('live: every type through open → reveal; nothing leaks before reveal', async () => {
  await withServer(async (base) => {
    const { g } = await mixedGame(base);
    const { code } = await (await post(`${base}/api/admin/games/${g.id}/sessions`, undefined, auth)).json();
    const join = async (name) => (await (await post(`${base}/live/api/${code}/join`, { name })).json()).token;
    const ana = await join('Ana'), bo = await join('Bo');
    const next = () => post(`${base}/api/admin/sessions/${code}/next`, undefined, auth);
    const state = async () => (await fetch(`${base}/live/api/${code}/state`)).json();
    const send = (token, body) => post(`${base}/live/api/${code}/guess`, { token, ...body });

    await next(); // open round 0 (location)
    await send(ana, { ord: 0, lat: 35.69, lng: 139.7 });
    await next(); await next(); // reveal, open round 1 (text)
    let s = await state();
    assert.deepEqual(s.round, { ord: 1, question: 'Longest rail tunnel?', type: 'text' });
    assert.equal(s.reveal, null);
    assert.equal((await send(ana, { ord: 1, lat: 1, lng: 2 })).status, 400);
    await send(ana, { ord: 1, answer: 'Simplon' });
    await send(bo, { ord: 1, answer: 'gotthard' });
    await next();
    s = await state();
    assert.deepEqual(s.reveal.guesses.map((x) => [x.name, x.answer, x.correct, x.points]),
      [['Bo', 'gotthard', true, 100], ['Ana', 'Simplon', false, 0]]); // points first
    assert.equal(s.reveal.truth.answer, 'Gotthard Base Tunnel');

    await next(); // open round 2 (choice)
    s = await state();
    assert.deepEqual(s.round.options, ['Shinjuku', 'Grand Central', 'Paris Nord']);
    assert.equal('correct' in s.round, false);
    await send(ana, { ord: 2, answer: 1 });
    await next();
    s = await state();
    assert.deepEqual([s.reveal.truth.correct, s.reveal.guesses[0].answer, s.reveal.guesses[0].correct], [1, 1, true]);

    await next(); // open round 3 (number)
    await send(bo, { ord: 3, answer: 60 });
    await next();
    s = await state();
    assert.deepEqual([s.reveal.guesses[0].answer, s.reveal.guesses[0].points], [60, 69]);
    assert.deepEqual(s.standings.map((x) => [x.name, x.total]), [['Ana', 200], ['Bo', 169]]);
  });
});

test('openGameDb rebuilds a 2026-10-23 file: rows kept, rounds become location, coords nullable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedb-'));
  const file = path.join(dir, 'game.db');
  try {
    const Database = require('better-sqlite3');
    const old = new Database(file);
    old.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL, question TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
        city TEXT, country TEXT, photo TEXT, story TEXT, answer TEXT, radius REAL, geometry TEXT, UNIQUE(game_id, ord));
      CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_name TEXT NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(game_id, player_name COLLATE NOCASE));
      CREATE TABLE guesses (play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE, round_ord INTEGER NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL, km REAL NOT NULL, points INTEGER NOT NULL, UNIQUE(play_id, round_ord));
      CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE, state TEXT NOT NULL, current_ord INTEGER, created_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE session_players (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, joined_at TEXT NOT NULL, UNIQUE(session_id, name COLLATE NOCASE));
      CREATE TABLE session_guesses (session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES session_players(id) ON DELETE CASCADE, round_ord INTEGER NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL, km REAL NOT NULL, points INTEGER NOT NULL, UNIQUE(session_id, player_id, round_ord));
      INSERT INTO games (slug, title, created_at) VALUES ('aaaabbbbccccdddd', 'old', 'now');
      INSERT INTO rounds (game_id, ord, question, lat, lng, radius) VALUES (1, 0, 'q', 1, 2, 20);
      INSERT INTO plays (game_id, player_name, total, created_at) VALUES (1, 'Ana', 90, 'now');
      INSERT INTO guesses (play_id, round_ord, lat, lng, km, points) VALUES (1, 0, 1.1, 2, 11.1, 90);
      INSERT INTO sessions (game_id, code, state, current_ord, created_at) VALUES (1, 'abcde12345', 'revealed', 0, 'now');
      INSERT INTO session_players (session_id, name, token, joined_at) VALUES (1, 'Bo', 'tok', 'now');
      INSERT INTO session_guesses (session_id, player_id, round_ord, lat, lng, km, points) VALUES (1, 1, 0, 1, 2, 0, 100);
    `);
    old.close();
    const db = openGameDb(file);
    const r = db.getGame(1).rounds[0];
    assert.deepEqual([r.type, r.spec, r.question, r.radius], ['location', null, 'q', 20]);
    assert.deepEqual(db.listPlays(1).map((p) => [p.player_name, p.total]), [['Ana', 90]]);
    assert.deepEqual(db.listGuesses(1, 0).map((x) => [x.name, x.points, x.answer]), [['Bo', 100, null]]);
    db.saveGame(1, 'old', [{ question: 'n', type: 'number', spec: { value: 3 } }]); // nullable coords now
    assert.equal(db.getGame(1).rounds[0].lat, null);
    db.raw.close();
    openGameDb(file).raw.close(); // second open is a no-op
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
