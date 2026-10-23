# Quiz

A geography quiz on a globe. The host builds rounds ("Where is the highest
railway station in the world?"), each with a secret point or shape, an
optional photo and a story. Players tap the globe, score by distance, and see
the reveal. Two ways to play:

- **Self-paced**: share `/<slug>`; everyone plays whenever and lands on a leaderboard.
- **Live**: press "Go live" in the builder, share `/live/<code>`, and drive the
  rounds from `/host/<code>` while every screen shows the same reveal — truth,
  everyone's pins, the ranking — in real time.

Built for the MapTap friends group, lifted out of
[maptap-scoreboard](https://github.com/AndreWeigel/maptap-scoreboard) on
2026-10-23 (history carried; see `docs/superpowers/specs/2026-10-23-quiz-repo-split-design.md`).

Node, Express, SQLite (better-sqlite3), MapLibre GL from a CDN. No build step.

## Setup

```sh
npm install
npm test
ADMIN_TOKEN=secret npm start      # http://localhost:3000/admin
```

`ADMIN_TOKEN` is the password for everything admin-side (HTTP Basic Auth, any
username). Unset = those pages are locked (503).

## URLs

Public (the link is the access control — slugs and codes are unguessable):

- `GET /<slug>` — the self-paced play page
- `GET /live/<code>` — the live play page (type a name, wait for the host)
- `GET /uploads/<file>` — photos; 16 random hex chars, only ever shown on a reveal
- `GET /healthz`

Admin (`ADMIN_TOKEN`):

- `GET /admin` — the builder: games, rounds, photos, shapes, Go live, sessions
- `GET /host/<code>` — the host page for a live session

API — self-paced: `GET /api/<slug>` (rounds without answers), `POST /api/<slug>/guess`
`{ ord, lat, lng }` → `{ km, points, nearest, truth }`, `POST /api/<slug>/plays`,
`GET /api/<slug>/leaderboard`. Live: `GET /live/api/<code>`, `POST …/join`,
`POST …/guess` `{ token, ord, lat, lng }`, `GET …/state?token=`, `GET …/events?token=`
(Server-Sent Events), `GET …/photo/<file>` (only once that round is revealed).
Admin: `GET/POST /api/admin/games`, `GET/PUT/DELETE /api/admin/games/:id`,
`GET/POST /api/admin/games/:id/sessions`, `POST /api/admin/sessions/:code/next|end`,
`POST /api/upload` (raw `image/*`, ≤ 8 MB).

## Rounds

A round's answer is a point with a full-points `radius` in km, or a **shape**:
paste GeoJSON (a line or an area) into the round's Shape box — draw one at
geojson.io, export from OpenStreetMap at overpass-turbo.eu, simplify big files
at mapshaper.org; max 5,000 points; shapes crossing the 180° meridian are
rejected. Scoring is distance to the nearest part of the shape, zero inside an
area. `points = km <= radius ? 100 : round(100 · e^(−(km − radius)/500))`.

## Data

`data/game.db` (games, rounds, plays, guesses, sessions) and `data/uploads/`
(photos). Both live in the compose volume. **Back them up.**

`scripts/import-photos.js <dir>` copies the photos that rounds reference from
another uploads folder (used once for the move from the scoreboard).

## Running in production (Docker)

Runs on the personal-cloud server; nginx proxies `quiz.andreweigel.me` →
`127.0.0.1:3001` (config in the `personal-cloud` repo, `nginx/quiz.conf`).

```sh
git clone https://github.com/AndreWeigel/quiz.git ~/quiz
cd ~/quiz
cp .env.example .env          # set ADMIN_TOKEN
docker compose up -d --build
curl localhost:3001/healthz
```

Update: `git pull --ff-only && docker compose up -d --build`. The GitHub
Actions deploy workflow does the same over SSH once the `DEPLOY_*` secrets are
set on the repo; until then, deploy by hand.

The live-session stream sends `X-Accel-Buffering: no` and a ping every 25 s,
so nginx needs no special config.

## Read this before touching the globe

`docs/HANDOVER-globe.md` — the MapLibre recipe, the screenshot method, and the
hard-won lessons. The design records are under `docs/superpowers/`.
