// The quiz's SQLite file (data/game.db): games, rounds, plays, guesses, live sessions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  theme      TEXT NOT NULL DEFAULT 'gameshow'
);
CREATE TABLE IF NOT EXISTS rounds (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ord      INTEGER NOT NULL,
  question TEXT NOT NULL,
  type     TEXT NOT NULL DEFAULT 'location',
  spec     TEXT,
  lat      REAL,
  lng      REAL,
  city     TEXT, country TEXT, photo TEXT, story TEXT,
  answer   TEXT, radius REAL, geometry TEXT,
  UNIQUE(game_id, ord)
);
CREATE TABLE IF NOT EXISTS plays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  total       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(game_id, player_name COLLATE NOCASE)
);
CREATE TABLE IF NOT EXISTS guesses (
  play_id   INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  round_ord INTEGER NOT NULL,
  lat       REAL,
  lng       REAL,
  km        REAL,
  answer    TEXT,
  points    INTEGER NOT NULL,
  UNIQUE(play_id, round_ord)
);
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  state       TEXT NOT NULL,
  current_ord INTEGER,
  created_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS session_players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  joined_at  TEXT NOT NULL,
  UNIQUE(session_id, name COLLATE NOCASE)
);
CREATE TABLE IF NOT EXISTS session_guesses (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES session_players(id) ON DELETE CASCADE,
  round_ord  INTEGER NOT NULL,
  lat REAL, lng REAL, km REAL, answer TEXT,
  points INTEGER NOT NULL,
  UNIQUE(session_id, player_id, round_ord)
);
`;

// A guess as stored: coordinates for location rounds, the raw answer (JSON:
// text, choice index or number) for the rest.
const guessRow = (g) => ({ lat: g.lat ?? null, lng: g.lng ?? null, km: g.km ?? null,
  answer: g.answer === undefined ? null : JSON.stringify(g.answer), points: g.points });

// The rounds whose truth may be shown: see the spec's "Revealed rounds" rule.
function revealedOrds(session, rounds) {
  const ords = rounds.map((r) => r.ord).sort((a, b) => a - b);
  if (session.state === 'lobby') return [];
  if (session.state === 'finished') return ords;
  return ords.filter((o) => (session.state === 'revealed' ? o <= session.current_ord : o < session.current_ord));
}

function openGameDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Files created before 2026-09-01 lack the trivia columns; CREATE IF NOT
  // EXISTS won't touch them, so bring them up with ALTERs.
  if (!db.prepare('PRAGMA table_info(games)').all().some((c) => c.name === 'theme')) {
    db.exec("ALTER TABLE games ADD COLUMN theme TEXT NOT NULL DEFAULT 'gameshow'");
  }
  const cols = db.prepare('PRAGMA table_info(rounds)').all().map((c) => c.name);
  if (!cols.includes('answer')) db.exec('ALTER TABLE rounds ADD COLUMN answer TEXT');
  if (!cols.includes('radius')) db.exec('ALTER TABLE rounds ADD COLUMN radius REAL');
  if (!cols.includes('geometry')) db.exec('ALTER TABLE rounds ADD COLUMN geometry TEXT');
  // Files created before 2026-10-27 have location-only rounds and guesses with
  // NOT NULL coordinates. ALTER can't drop NOT NULL, so rebuild the three tables.
  if (!cols.includes('type')) {
    db.transaction(() => {
      for (const t of ['rounds', 'guesses', 'session_guesses']) db.exec(`ALTER TABLE ${t} RENAME TO ${t}_old`);
      db.exec(SCHEMA);
      db.exec(`
        INSERT INTO rounds (id, game_id, ord, question, lat, lng, city, country, photo, story, answer, radius, geometry)
          SELECT id, game_id, ord, question, lat, lng, city, country, photo, story, answer, radius, geometry FROM rounds_old;
        INSERT INTO guesses (play_id, round_ord, lat, lng, km, points)
          SELECT play_id, round_ord, lat, lng, km, points FROM guesses_old;
        INSERT INTO session_guesses (session_id, player_id, round_ord, lat, lng, km, points)
          SELECT session_id, player_id, round_ord, lat, lng, km, points FROM session_guesses_old;
        DROP TABLE rounds_old; DROP TABLE guesses_old; DROP TABLE session_guesses_old;
      `);
    })();
  }

  const insertRound = db.prepare(`
    INSERT INTO rounds (game_id, ord, question, type, spec, lat, lng, city, country, photo, story, answer, radius, geometry)
    VALUES (@game_id, @ord, @question, @type, @spec, @lat, @lng, @city, @country, @photo, @story, @answer, @radius, @geometry)
  `);
  const insertGuess = db.prepare(`
    INSERT INTO guesses (play_id, round_ord, lat, lng, km, answer, points)
    VALUES (@play_id, @round_ord, @lat, @lng, @km, @answer, @points)
  `);
  const insertPlay = db.transaction((gameId, playerName, total, guesses) => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO plays (game_id, player_name, total, created_at) VALUES (?, ?, ?, ?)'
    ).run(gameId, playerName, total, new Date().toISOString());
    for (const g of guesses) insertGuess.run({ play_id: lastInsertRowid, round_ord: g.round_ord, ...guessRow(g) });
    return { id: lastInsertRowid };
  });
  const replaceRounds = db.transaction((id, title, rounds, theme) => {
    db.prepare('UPDATE games SET title = ?, theme = COALESCE(?, theme) WHERE id = ?').run(title, theme ?? null, id);
    db.prepare('DELETE FROM rounds WHERE game_id = ?').run(id);
    rounds.forEach((r, ord) => insertRound.run({
      game_id: id, ord, question: r.question, type: r.type || 'location', spec: r.spec ? JSON.stringify(r.spec) : null,
      lat: r.lat ?? null, lng: r.lng ?? null,
      city: r.city ?? null, country: r.country ?? null, photo: r.photo ?? null, story: r.story ?? null,
      answer: r.answer ?? null, radius: r.radius ?? null,
      geometry: r.geometry ? JSON.stringify(r.geometry) : null,
    }));
  });

  const now = () => new Date().toISOString();
  const getSession = (code) => db.prepare('SELECT * FROM sessions WHERE code = ?').get(code) || null;
  const roundOrds = (gameId) =>
    db.prepare('SELECT ord FROM rounds WHERE game_id = ? ORDER BY ord').all(gameId).map((r) => r.ord);
  const setState = db.prepare('UPDATE sessions SET state = ?, current_ord = ?, finished_at = ? WHERE id = ?');

  // Host's "Next": lobby → open(first) → revealed → open(next) … → finished.
  const advance = db.transaction((code) => {
    const s = getSession(code);
    if (!s) return null;
    if (s.state === 'finished') throw new RangeError('session finished');
    const ords = roundOrds(s.game_id);
    let state = 'finished', ord = s.current_ord, finishedAt = null;
    if (s.state === 'lobby' && ords.length) { state = 'open'; ord = ords[0]; }
    else if (s.state === 'open') state = 'revealed';
    else if (s.state === 'revealed') {
      const i = ords.indexOf(s.current_ord);
      if (i + 1 < ords.length) { state = 'open'; ord = ords[i + 1]; }
    }
    if (state === 'finished') finishedAt = now();
    setState.run(state, ord, finishedAt, s.id);
    return getSession(code);
  });
  const upsertGuessStmt = db.prepare(`
    INSERT INTO session_guesses (session_id, player_id, round_ord, lat, lng, km, answer, points)
    VALUES (@session_id, @player_id, @round_ord, @lat, @lng, @km, @answer, @points)
    ON CONFLICT(session_id, player_id, round_ord) DO UPDATE SET
      lat = excluded.lat, lng = excluded.lng, km = excluded.km, answer = excluded.answer, points = excluded.points
  `);

  return {
    raw: db,

    createGame(title) {
      const slug = crypto.randomBytes(8).toString('hex'); // the link IS the access control
      db.prepare('INSERT INTO games (slug, title, created_at) VALUES (?, ?, ?)')
        .run(slug, title, new Date().toISOString());
      return db.prepare('SELECT * FROM games WHERE slug = ?').get(slug);
    },

    listGames() {
      return db.prepare(`
        SELECT g.*,
          (SELECT COUNT(*) FROM rounds r WHERE r.game_id = g.id) AS rounds,
          (SELECT COUNT(*) FROM plays p WHERE p.game_id = g.id) AS plays
        FROM games g ORDER BY g.id DESC
      `).all();
    },

    getGame(id) {
      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
      if (!game) return null;
      const rounds = db.prepare('SELECT * FROM rounds WHERE game_id = ? ORDER BY ord').all(id)
        .map((r) => ({ ...r, spec: r.spec ? JSON.parse(r.spec) : null, geometry: r.geometry ? JSON.parse(r.geometry) : null }));
      return { game, rounds };
    },

    saveGame(id, title, rounds, theme) {
      replaceRounds(id, title, rounds, theme);
      return this.getGame(id);
    },

    deleteGame(id) {
      return { deleted: db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0 };
    },

    getGameBySlug(slug) {
      const game = db.prepare('SELECT * FROM games WHERE slug = ?').get(slug);
      return game ? this.getGame(game.id) : null;
    },

    // guesses: [{ round_ord, lat, lng, km, points }] — one transaction with the
    // play row; throws SQLITE_CONSTRAINT on a duplicate (game, name) pair.
    recordPlay(gameId, playerName, total, guesses) {
      return insertPlay(gameId, playerName, total, guesses);
    },

    listPlays(gameId) {
      return db.prepare(
        'SELECT player_name, total, created_at FROM plays WHERE game_id = ? ORDER BY total DESC, created_at'
      ).all(gameId);
    },

    // ---- Live sessions ----
    createSession(gameId) {
      const code = crypto.randomBytes(5).toString('hex'); // the join link IS the access control
      db.prepare('INSERT INTO sessions (game_id, code, state, created_at) VALUES (?, ?, ?, ?)')
        .run(gameId, code, 'lobby', now());
      return getSession(code);
    },
    getSession,
    listSessions(gameId) {
      return db.prepare(`
        SELECT s.code, s.state, s.current_ord, s.created_at, s.finished_at,
          (SELECT COUNT(*) FROM session_players p WHERE p.session_id = s.id) AS players
        FROM sessions s WHERE s.game_id = ? ORDER BY s.id DESC
      `).all(gameId);
    },
    advanceSession(code) { return advance(code); },
    endSession(code) {
      const s = getSession(code);
      if (!s) return null;
      setState.run('finished', s.current_ord, now(), s.id);
      return getSession(code);
    },
    joinSession(sessionId, name) {
      const token = crypto.randomBytes(16).toString('hex');
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO session_players (session_id, name, token, joined_at) VALUES (?, ?, ?, ?)'
      ).run(sessionId, name, token, now());
      return { id: Number(lastInsertRowid), name, token };
    },
    playerByToken(token) {
      return db.prepare('SELECT id, session_id, name FROM session_players WHERE token = ?').get(token) || null;
    },
    listPlayers(sessionId) {
      return db.prepare('SELECT id, name, joined_at FROM session_players WHERE session_id = ? ORDER BY id').all(sessionId);
    },
    upsertGuess(sessionId, playerId, ord, g) {
      upsertGuessStmt.run({ session_id: sessionId, player_id: playerId, round_ord: ord, ...guessRow(g) });
    },
    listGuesses(sessionId, ord) {
      return db.prepare(`
        SELECT g.player_id, p.name, g.lat, g.lng, g.km, g.answer, g.points
        FROM session_guesses g JOIN session_players p ON p.id = g.player_id
        WHERE g.session_id = ? AND g.round_ord = ? ORDER BY g.points DESC, g.km, p.id
      `).all(sessionId, ord).map((g) => ({ ...g, answer: g.answer == null ? null : JSON.parse(g.answer) }));
    },
    // Cumulative points over the given round ords; everyone who joined appears (0 if no guess).
    standings(sessionId, ords) {
      const list = ords.length ? ords.map(() => '?').join(',') : 'NULL';
      return db.prepare(`
        SELECT p.id AS player_id, p.name, COALESCE(SUM(g.points), 0) AS total
        FROM session_players p
        LEFT JOIN session_guesses g ON g.player_id = p.id AND g.round_ord IN (${list})
        WHERE p.session_id = ? GROUP BY p.id ORDER BY total DESC, p.id
      `).all(...ords, sessionId);
    },
  };
}

module.exports = { openGameDb, revealedOrds };
