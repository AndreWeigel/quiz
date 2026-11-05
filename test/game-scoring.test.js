const { test } = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, points } = require('../src/scoring');

test('haversineKm: Porto→Lisbon ≈ 274 km, zero for same point', () => {
  const km = haversineKm(41.15, -8.61, 38.7078, -9.1366);
  assert.ok(Math.abs(km - 274) < 5, `got ${km}`);
  assert.equal(haversineKm(33.0106, 91.6642, 33.0106, 91.6642), 0);
});

test('points: full inside radius, exp decay after, radius tunes the zone', () => {
  assert.equal(points(0), 100);
  assert.equal(points(25), 100);
  assert.equal(points(525), Math.round(100 * Math.exp(-1))); // 37
  assert.equal(points(24.9, 20), Math.round(100 * Math.exp(-4.9 / 500)));
  assert.equal(points(19, 20), 100);
  assert.ok(points(200) > points(300), 'monotonic decay');
});

const { distanceToRound } = require('../src/scoring');

test('distanceToRound: point round → haversine to the point; shape round → nearest on the shape', () => {
  const pt = distanceToRound(1, 0, { lat: 0, lng: 0, geometry: null });
  assert.equal(pt.km, 111.2);
  assert.deepEqual(pt.nearest, { lat: 0, lng: 0 });
  const line = distanceToRound(1, 5, { lat: 0, lng: 5, geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } });
  assert.equal(line.km, 111.2);
  assert.deepEqual(line.nearest, { lat: 0, lng: 5 });
  const inside = distanceToRound(5, 5, { lat: 5, lng: 5, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } });
  assert.deepEqual(inside, { km: 0, nearest: { lat: 5, lng: 5 } });
});

test('points: maxkm drops evenly from the radius to 0, and round-trips through the type', () => {
  assert.equal(points(25, 25, 3025), 100);
  assert.equal(points(1525, 25, 3025), 50);
  assert.equal(points(3025, 25, 3025), 0);
  assert.equal(points(9000, 25, 3025), 0);
  const { TYPES } = require('../src/types');
  const loc = TYPES.location;
  assert.equal(loc.clean({ lat: 35.7, lng: 139.7, maxkm: 3000 }).maxkm, 3000);
  assert.ok(loc.clean({ lat: 35.7, lng: 139.7, radius: 50, maxkm: 40 }).error, 'maxkm inside the radius is rejected');
  // Tokyo round: a pin in Beijing (~2100 km) still scores, one in New York (~10,850 km) doesn't.
  const round = { lat: 35.68, lng: 139.69, maxkm: 5000 };
  assert.ok(loc.score(round, { lat: 39.9, lng: 116.4 }).points > 50);
  assert.equal(loc.score(round, { lat: 40.71, lng: -74 }).points, 0);
});
