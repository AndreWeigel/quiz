# Spec: Question types (typed answer, multiple choice, number estimate)

2026-10-27. Today every round is a location round: tap the globe, score by
distance. A quiz becomes a mix — location, then a typed answer, then multiple
choice, then location again — in both self-paced play (`/:slug`) and live
sessions (`/live/:code`, `/host/:code`). First use: a railway quiz for André's
company meeting.

Decisions made with André on 2026-10-27, in brainstorming. Don't re-litigate:

| Question | Decision |
|---|---|
| Types in v1 | **Location** (unchanged), **Typed answer**, **Multiple choice**, **Number estimate**. More may follow; adding one should mean one new entry in one module, not a rewrite. |
| Typed-answer marking | **Automatic and forgiving.** The builder lists accepted answers; matching ignores case, accents, punctuation, a leading "the", and small typos. Right = 100, wrong = 0. No host override in v1. |
| Multiple-choice scoring | **100 or 0.** 2–6 options, exactly one correct. No speed bonus. |
| Number scoring | Same shape as distance: full points within a tolerance, smooth decay beyond it (formula in §3, with a "points halve every ±X" knob). |
| Play modes | **Both** self-paced links and live sessions support every type. |
| Out of scope | Host override of typed answers, speed bonus, multiple correct options, ordering/sequence questions, image-choice options, per-player answer history pages. |

## 1. Data model

`rounds` gains two columns:

- `type TEXT NOT NULL DEFAULT 'location'` — `location | text | choice | number`.
- `spec TEXT` — JSON, the type's own fields (null for `location`):
  - `text`: `{ "accept": ["Gotthard", "Gotthard Base Tunnel"] }` (1–20 entries, each ≤ 100 chars)
  - `choice`: `{ "options": ["Paris", "Tokyo", "Lima"], "correct": 1 }` (2–6 options ≤ 100 chars; `correct` is an index)
  - `number`: `{ "value": 57, "unit": "km", "tolerance": 0, "halve": 10 }` (`value` finite; `unit` optional ≤ 20 chars; `tolerance` ≥ 0, default 0; `halve` > 0, optional)

`lat`/`lng` become **nullable** (only location rounds have them). Common fields
stay common: `question`, `photo`, `story`, `answer` (the reveal label —
for a `text` round it defaults to `accept[0]`).

`guesses` and `session_guesses` gain `answer TEXT` (the player's raw typed
text, choice index, or number, as given) and their `lat`/`lng`/`km` become
nullable. `points` stays `NOT NULL` — every guess is scored server-side.

**Migration.** SQLite can't drop `NOT NULL` with `ALTER`, so `openGameDb`
rebuilds the three tables when `rounds.type` is missing: one transaction,
create `*_new` with the new schema, `INSERT … SELECT` (existing rows get
`type = 'location'`, `answer = NULL`), drop old, rename. No table references
`rounds.id` or `guesses` rows by id, so nothing else changes. Covered by a test
that opens a database written with today's schema.

## 2. One module per concern: `src/types.js`

A table keyed by type, each entry with the same five functions, so routes and
live sessions never branch on type themselves:

| Function | Purpose |
|---|---|
| `clean(r)` | Validate the builder's round fields → `{ spec }` or `{ error }`. Location's `clean` is today's coords/geometry/radius logic moved out of `routes.js`. |
| `publicRound(round)` | What players see before answering: `{ ord, question, type }` plus `options` (choice) or `unit` (number). **Never** the correct answer. |
| `cleanGuess(round, body)` | Validate a guess → `{ lat, lng }` / `{ answer }` or `null` (→ 400). |
| `score(round, guess)` | → `{ points, km?, nearest?, correct? }`. |
| `truth(round)` | What a reveal shows: today's location truth, or `{ answer label, correct index / value + unit, photo, story }`. |

Adding a type later = one new entry here + its builder fields + its answer
widget on the two play pages.

## 3. Scoring

- **Location** — unchanged (`points(km, radius)`).
- **Choice** — `100` if the index equals `correct`, else `0`.
- **Text** — normalize both sides: lowercase, strip accents (NFD, drop
  combining marks), replace punctuation with spaces, collapse whitespace, drop
  a leading `the `. Correct if the normalized guess equals a normalized accepted
  answer, or is within an edit distance of `0` (≤ 3 chars), `1` (≤ 6), `2`
  (longer) of one. `100` or `0`.
- **Number** — `err = |guess − value|`; `100` if `err ≤ tolerance`, else
  `round(100 · 0.5 ^ ((err − tolerance) / halve))`: points halve for every
  `halve` units beyond the tolerance. `halve` defaults to
  `max(|value| / 10, 1)`, which suits sizes and counts; years need it set
  (a year's 10 % is two centuries). Examples: Gotthard 57 km, defaults →
  guess 60 scores 69, guess 50 scores 43. Opening year 1825, `halve` 10 →
  1815 scores 50, 1800 scores 18.

All four live in `src/scoring.js` (location's formula already does), each with
table-driven tests.

## 4. API changes

- `GET /api/:slug` → `rounds: [publicRound(r)]` (adds `type`, `options`, `unit`).
- `POST /api/:slug/guess` → body is `{ ord, lat, lng }` or `{ ord, answer }`
  depending on the round's type; response `{ points, truth, …score fields }`.
  Still stateless, still honor-system for peeking.
- `POST /api/:slug/plays` → each guess `{ ord, lat, lng }` or `{ ord, answer }`;
  every point recomputed server-side, as today.
- Live: `POST /live/api/:code/guess` accepts the same two shapes. The snapshot's
  `round` becomes `publicRound(r)`; `reveal.truth` comes from `truth(r)`;
  `reveal.guesses[]` adds `answer` and `correct`, ordered by `points DESC`, then
  `km`, then join order.

Old clients keep working: location bodies are unchanged.

## 5. Builder (`/admin`)

Each round card gets a **type selector** at the top (Location · Typed answer ·
Multiple choice · Number). The location row (city / coords / map / shape /
radius) shows only for Location. The others show:

- **Typed answer** — "Accepted answers", one per line.
- **Multiple choice** — 2–6 option inputs, a radio marks the correct one,
  "+ option" / ✕ per option.
- **Number** — value, unit (optional), "full points within ±" (default 0),
  "points halve every ±" (placeholder shows the default, 10 % of the value).

Question, answer label, photo and story stay on every type. Switching type
keeps the common fields and drops the type-specific ones (after a confirm if
any were filled). Save validation per type mirrors the server's `clean`.

## 6. Play pages

Both `play.html` and `live.html` keep the globe as the backdrop. For
non-location rounds, map taps are ignored and an **answer card** appears over
the globe, bottom-centre on phones:

- Text: one input + "Submit" (Enter submits).
- Choice: one big button per option; tapping selects, "Submit" confirms (live:
  tap again to change until the host reveals, same as moving a pin).
- Number: a numeric input with the unit as a suffix + "Submit".

Reveal for non-location rounds: the existing reveal card/panel shows the right
answer (✓/✗ or "you said 60 · answer 57 km"), points, photo, story. In live
mode the host panel lists every player's answer with ✓/✗ and points, sorted by
points. The camera does not move.

The answer card markup and handlers are duplicated in the two pages (as the
map recipe already is); no shared asset route is added.

## 7. Tests and verification

- Unit: each scoring function; text normalization and typo tolerance (e.g.
  "gotard" ✓ for "Gotthard", "Zurich" ✓ for "Zürich", "Paris" ✗ for "Lima");
  number formula examples above.
- Routes: save + fetch a mixed game; `publicRound` never leaks `accept`,
  `correct`, or `value`; guess and plays for each type; bad answers → 400.
- Live: a session through one round of each type; snapshot before reveal has no
  truth; reveal ordering.
- Migration: a database created with the 2026-10-23 schema opens, keeps its
  rounds/plays/guesses, and its rounds read back as `type: 'location'`.
- UI: headless-Chrome screenshots (method in `HANDOVER-globe.md`) of the
  builder with one round of each type, and of play + live (player and host) for
  each type's question and reveal, phone and desktop widths.

## 8. Slices

1. Data model, migration, `src/types.js`, scoring, routes, live API — with
   tests. Existing pages keep working (location only).
2. Builder: type selector and fields.
3. Self-paced play page.
4. Live page (player and host).

Each slice is merged and deployable on its own; slice 1 ships no visible change.
