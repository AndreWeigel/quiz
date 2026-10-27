// Question types. Every entry has the same five functions, so routes and live
// sessions never branch on a round's type themselves:
//   clean(r)              builder fields → the type's own columns, or { error }
//   publicRound(round)    what players see before answering — never the answer
//   cleanGuess(round, b)  request body → a guess, or null (→ 400)
//   score(round, guess)   → { points, …extras for the reveal }
//   truth(round)          what a reveal shows
const { points, distanceToRound, textCorrect, numberPoints } = require('./scoring');
const { normalizeGeometry, bboxCenter } = require('./geo');

const optStr = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const validCoords = (lat, lng) =>
  Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
const common = (round) => ({ photo: round.photo, story: round.story });

const TYPES = {
  location: {
    clean(r) {
      let geometry = normalizeGeometry(r.geometry);
      if (geometry && geometry.error) return geometry;
      let { lat, lng } = r;
      if (geometry && geometry.type === 'Point') { [lng, lat] = geometry.coordinates; geometry = null; } // a point is a point round
      else if (geometry) ({ lat, lng } = bboxCenter(geometry)); // the anchor can never disagree with the shape
      if (!validCoords(lat, lng)) return { error: 'invalid round' };
      // radius: optional "full points within this many km" tolerance (trivia rounds)
      if (r.radius != null && !(Number.isFinite(r.radius) && r.radius > 0 && r.radius <= 10000)) return { error: 'invalid round' };
      return { lat, lng, city: optStr(r.city), country: optStr(r.country), radius: r.radius ?? undefined, geometry: geometry || undefined };
    },
    publicRound: () => ({}),
    cleanGuess: (_round, b) => (validCoords(b.lat, b.lng) ? { lat: b.lat, lng: b.lng } : null),
    score(round, g) {
      const { km, nearest } = distanceToRound(g.lat, g.lng, round);
      return { km, nearest, points: points(km, round.radius ?? undefined) };
    },
    truth: (round) => ({
      ...common(round), lat: round.lat, lng: round.lng, city: round.city, country: round.country,
      answer: round.answer, radius: round.radius, geometry: round.geometry || null,
    }),
  },

  text: {
    clean(r) {
      const accept = Array.isArray(r.spec && r.spec.accept) ? r.spec.accept.map(optStr).filter(Boolean) : [];
      if (!accept.length || accept.length > 20 || accept.some((a) => a.length > 100)) {
        return { error: 'typed answer: list 1–20 accepted answers' };
      }
      return { spec: { accept } };
    },
    publicRound: () => ({}),
    cleanGuess: (_round, b) => {
      const a = optStr(b.answer);
      return a && a.length <= 100 ? { answer: a } : null;
    },
    score(round, g) {
      const correct = textCorrect(g.answer, round.spec.accept);
      return { correct, points: correct ? 100 : 0 };
    },
    truth: (round) => ({ ...common(round), answer: round.answer || round.spec.accept[0] }),
  },

  choice: {
    clean(r) {
      const s = r.spec || {};
      const options = Array.isArray(s.options) ? s.options.map(optStr) : [];
      if (options.length < 2 || options.length > 6 || options.some((o) => !o || o.length > 100)
        || !Number.isInteger(s.correct) || s.correct < 0 || s.correct >= options.length) {
        return { error: 'multiple choice: 2–6 filled options, one marked correct' };
      }
      return { spec: { options, correct: s.correct } };
    },
    publicRound: (round) => ({ options: round.spec.options }),
    cleanGuess: (round, b) =>
      (Number.isInteger(b.answer) && b.answer >= 0 && b.answer < round.spec.options.length ? { answer: b.answer } : null),
    score(round, g) {
      const correct = g.answer === round.spec.correct;
      return { correct, points: correct ? 100 : 0 };
    },
    truth: (round) => ({
      ...common(round), correct: round.spec.correct,
      answer: round.answer || round.spec.options[round.spec.correct],
    }),
  },

  number: {
    clean(r) {
      const { value, unit, tolerance = 0, halve } = r.spec || {};
      if (!Number.isFinite(value) || !(Number.isFinite(tolerance) && tolerance >= 0)
        || (halve != null && !(Number.isFinite(halve) && halve > 0))
        || (unit != null && (typeof unit !== 'string' || unit.length > 20))) {
        return { error: 'number: needs a value; tolerance ≥ 0 and halve > 0' };
      }
      return { spec: { value, unit: optStr(unit), tolerance, halve: halve ?? undefined } };
    },
    publicRound: (round) => ({ unit: round.spec.unit }),
    cleanGuess: (_round, b) => (Number.isFinite(b.answer) ? { answer: b.answer } : null),
    score(round, g) {
      const p = numberPoints(g.answer, round.spec);
      return { correct: p === 100, points: p };
    },
    truth: (round) => ({
      ...common(round), value: round.spec.value, unit: round.spec.unit,
      answer: round.answer || [round.spec.value, round.spec.unit].filter((x) => x != null).join(' '),
    }),
  },
};

const typeOf = (round) => TYPES[round.type || 'location'];
const publicRound = (round) => ({ ord: round.ord, question: round.question, type: round.type || 'location', ...typeOf(round).publicRound(round) });

module.exports = { TYPES, typeOf, publicRound, optStr };
