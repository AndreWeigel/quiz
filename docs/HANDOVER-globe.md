# Handover: the globe stack (quiz)

Lifted from maptap-scoreboard on 2026-10-23; the people album (`/globe`) stayed there.

2026-09-07. Written after slices 1–3 shipped. This is the "what we actually
use and why" reference for anything that renders a globe. The older
`HANDOVER-globe-game.md` is the pre-implementation decision record — read it
for *why*, read this for *what's there*.

## One line

**MapLibre GL 6.6.0, loaded from jsdelivr as ESM, no build step, not an npm
dependency** — with `projection: { type: 'globe' }`, Esri World Imagery raster
tiles, and a hand-written sky/atmosphere block. Three pages use it, each
differently.

## Where the globe appears

| Page | File | Route | Projection | MapLibre load |
|---|---|---|---|---|
| Play a game | `views/play.html` | `GET /:slug` ([routes.js](src/routes.js)) | globe | static namespace import |
| Builder location picker | `views/builder.html` | `GET /admin` (Basic Auth) | **flat** (mercator) | lazy `await import()` on first open |
| Live session (player + host) | `views/live.html` | `GET /live/:code`, `GET /host/:code` ([live.js](src/live.js)) | globe | static namespace import |

The builder's picker is deliberately flat — picking a point is easier on a
mercator map than on a sphere — and lazy-loaded, so only game builders pay the
~1 MB.

## The shared recipe

Copy this if you ever add a fourth globe. Both globe pages (play and live) use it verbatim.

```js
import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.6.0/dist/maplibre-gl.mjs';

const map = new maplibregl.Map({
  container: 'map',
  attributionControl: false, // a hand-written .credit line carries the Esri notice
  minZoom: 1, maxZoom: 17, center: [10, 35], zoom: 1.8,
  style: {
    version: 8,
    projection: { type: 'globe' },
    sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 17,
      attribution: 'Imagery © Esri & contributors',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    sky: { 'sky-color': '#02040f', 'horizon-color': '#0e5d7a', 'fog-color': '#070b1c',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 1, 8, 0.1] } },
});
window.map = map; // console/debug handle — the screenshot driver steers the camera with it
```

CSS comes from the same CDN path
(`.../maplibre-gl@6.6.0/dist/maplibre-gl.css`). Tiles need no API key; keep
the "Imagery © Esri & contributors" credit visible.

Reveal overlays (both play pages): one `truth` geojson source with three
layers — `truth-fill` (areas), `truth-line` (lines and outlines), `truth`
(points) — filtered on `['geometry-type']`, so a point round still renders as
the gold dot. Geometry math is server-side in `src/geo.js`; the pages
only draw what `/guess` or the live snapshot hands them (`truth.geometry`,
`nearest`).

## Geocoding: Nominatim, no key, two calls

- **Search** — `views/builder.html:317` (the scoreboard's `/users` page uses the same call):
  `search?format=jsonv2&addressdetails=1&accept-language=en&limit=5&q=…`,
  user picks from a top-5 list, structured `city/country/lat/lng` stored.
- **Reverse** — `views/builder.html:220`, after a map click:
  `reverse?format=jsonv2&accept-language=en&zoom=10&lat=…&lon=…`. Best-effort
  label only; the coords are already set by the click.
- City field is always
  `a.city || a.town || a.village || a.hamlet || a.municipality || a.county || h.name`.
- Rate-limited and keyless — every call is wrapped in `try {} catch {}` and
  failure just leaves the ⚠ marker. Never make it a hard dependency.

## `/:slug` — the play page

[play.html](views/play.html). Slug is read from the URL path; every call
goes to `/api/:slug…`.

- Two GeoJSON sources added on `load` and seeded with an empty
  FeatureCollection: `truth` (gold circle) and `line` (dashed cyan line).
  Round transitions just `setData(EMPTY)`.
- The guess is a **draggable `maplibregl.Marker`**; `map.on('click')` places or
  moves it. Longitudes always go through `.wrap()` before leaving the page.
- **Phase machine**: `load | name | guess | reveal | done`, one `#action`
  button whose label and handler follow the phase.
- Confirm → `POST /guess` → server answers `{ km, points, truth }` → draw the
  truth dot + line, then `fitBounds([guess, truth], { padding: 90, maxZoom: 9 })`
  (duration 0 under reduced motion).
- Player name lives in `localStorage['maptap:player']`.
- Finish → `POST /plays` with every guess; **the server recomputes every
  point** — client totals are never trusted. A repeat name gets `409` plus the
  leaderboard.
- `window.playState = { place, confirm, next }` — the debug/driver handle used
  by the screenshot harness.

## Server side

Everything the game needs lives in `src/` + `views/` and is mounted
with **one line** ([index.js](src/index.js)):

```js
app.use('/', gameRoutes({ basicAuth, dbPath, uploadsDir }));
```

- **Own SQLite file**, `data/game.db` ([db.js](src/db.js)).
  Schema: `games / rounds / plays / guesses`, WAL, foreign keys
  on, with in-place `ALTER TABLE` migrations for the `answer` and `radius`
  columns added on 2026-09-01.
- **Slug = 16 random hex chars, and it *is* the access control** for playing:
  anyone with the link can play. Round photos come from `/uploads`, which is
  public (see Photos below); their names are unguessable and only shown on a
  reveal.
- **Scoring** ([scoring.js:6](src/scoring.js#L6)):
  `points(km, radius = 25)` → 100 inside the round's tolerance radius, then
  `round(100 * exp(-(km - radius) / 500))`. Haversine on a 6371 km sphere.
  Tested in `test/game-scoring.test.js`.
- **Photos**: `POST /api/upload` (Basic Auth, raw `image/*`, 8 MB cap) writes a
  random 16-hex filename; `/uploads` is static with `maxAge: 365d, immutable`,
  served publicly (`src/index.js`); only the upload endpoint needs `ADMIN_TOKEN`.
  The `PHOTO_FILE` regex lives in `src/routes.js` and `src/live.js`
  (and the upload handler in `src/index.js` produces matching names).
- Replay block is a `UNIQUE(game_id, player_name COLLATE NOCASE)` constraint,
  caught as `SQLITE_CONSTRAINT` → 409.

Known and accepted: `POST /guess` reveals a round's truth without requiring a
real guess. Honor system, by design.

## Gotchas — do not rediscover these

1. **MapLibre 6.6.0 is ESM-only with no default export.** `import * as
   maplibregl from …mjs`. A default import silently gives you `undefined`.
2. **Never load three.js-family libs via jsdelivr `/+esm`.** The bundle graph
   pulled three separate three.js copies and the globe rendered black. If ever
   needed: esm.sh with `?deps=three@<ver>`. Nothing here uses three today.
3. **DOM markers are not occluded by the sphere.** That's the entire reason
   `degFromCenter`/`LIMB` exists. If you add a new marker type, it needs the
   same treatment — or make it a map layer instead.
4. **Screenshot verification**: `--virtual-time-budget` is unreliable for
   tile-loading pages (nondeterministic half-loaded frames). The working trick
   is a stub server route `/slow?ms=25000` (a 1×1 gif delayed N ms) embedded in
   a driver page, so headless Chrome's shutter waits in *real* time. The driver
   iframes the target and steers it via `window.map` / `window.playState`.
5. On a Node ≥ 26 machine `npm install` fails to build better-sqlite3 11; use
   `npm install --ignore-scripts` then `npm install --no-save better-sqlite3@13`
   (never commit that bump). Production is Node 22 via the Dockerfile, where 11
   builds fine.

## State of play

Shipped: the game builder, the play page + scoring + leaderboard, live
sessions, shapes, plus two UI/accessibility polish passes. Specs and plans are
in `docs/superpowers/`.

Deploy: see "Running in production (Docker)" in the README.
