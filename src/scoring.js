// Distance scoring for custom games (spec-pinned formula). Dependency-free on
// purpose. Geometry lives in ./geo.
const { haversineKm, nearestOnGeometry } = require('./geo');

// Full points within the round's tolerance radius, smooth decay beyond it.
function points(km, radius = 25) {
  return km <= radius ? 100 : Math.round(100 * Math.exp(-(km - radius) / 500));
}

// Distance from a guess to a round's answer: its shape, or its point. km has one decimal.
function distanceToRound(lat, lng, round) {
  const n = round.geometry
    ? nearestOnGeometry(lat, lng, round.geometry)
    : { km: haversineKm(lat, lng, round.lat, round.lng), lat: round.lat, lng: round.lng };
  return { km: Math.round(n.km * 10) / 10, nearest: { lat: n.lat, lng: n.lng } };
}

// Lowercase, no accents, punctuation as spaces, no leading "the".
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the /, '');

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Typed answer: matches any accepted answer, forgiving 1–2 typos on longer
// words. Answers with digits (years, numbers) must match exactly.
function textCorrect(guess, accept) {
  const g = norm(guess);
  if (!g) return false;
  return accept.some((a) => {
    const n = norm(a);
    const slack = /\d/.test(n) || n.length <= 3 ? 0 : n.length <= 6 ? 1 : 2;
    return editDistance(g, n) <= slack;
  });
}

// Number estimate: full points within the tolerance, then points halve every
// `halve` units further off (default 10 % of the answer, at least 1).
function numberPoints(guess, { value, tolerance = 0, halve }) {
  const err = Math.abs(guess - value);
  if (err <= tolerance) return 100;
  const h = halve ?? Math.max(Math.abs(value) / 10, 1);
  return Math.round(100 * 0.5 ** ((err - tolerance) / h));
}

module.exports = { haversineKm, points, distanceToRound, textCorrect, numberPoints };
