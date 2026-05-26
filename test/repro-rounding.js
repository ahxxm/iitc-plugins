// Reproduce the rounding-discrepancy bug: portal._point is rounded to int pixels
// by Leaflet (Marker._update calls .round()), but existing-link endpoints are
// projected unrounded in collectExistingLinks. A portal that's sub-pixel away
// from an existing link can land exactly on the link's line after rounding,
// making the ccw test give 0 and the strict crossing test miss.

'use strict';

function ccw(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
function segmentsCross(s, t) {
  if (s.aId && (s.aId === t.aId || s.aId === t.bId)) return false;
  if (s.bId && (s.bId === t.aId || s.bId === t.bId)) return false;
  var EPS = 0.5;
  function near(p, q) { return Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS; }
  if (near(s.a, t.a) || near(s.a, t.b) || near(s.b, t.a) || near(s.b, t.b)) return false;
  var d1 = ccw(t.a[0], t.a[1], t.b[0], t.b[1], s.a[0], s.a[1]);
  var d2 = ccw(t.a[0], t.a[1], t.b[0], t.b[1], s.b[0], s.b[1]);
  var d3 = ccw(s.a[0], s.a[1], s.b[0], s.b[1], t.a[0], t.a[1]);
  var d4 = ccw(s.a[0], s.a[1], s.b[0], s.b[1], t.b[0], t.b[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Simulate Leaflet projection: latLngToLayerPoint returns unrounded; _point rounds.
function project(latlng) { return [latlng[0], latlng[1]]; }                 // unrounded — as collectExistingLinks does
function projectRounded(latlng) { return [Math.round(latlng[0]), Math.round(latlng[1])]; } // rounded — as portal._point does

// True portal latlngs (in pixel-equivalent space for simplicity)
var trueLL = {
  A: [0, 0],
  C: [1000, 0],
  B: [500, 0.49],       // B is 0.49 px above line A-C — sub-pixel
  E1: [200, -200],
  E2: [800, -200],
  P: [400, 400],
};

// What the algorithm sees:
//   portal positions  -> rounded (because it reads _point)
//   existing-link endpoints -> unrounded (because collectExistingLinks uses latLngToLayerPoint)
var portalPos = {};
for (var id in trueLL) portalPos[id] = projectRounded(trueLL[id]);

console.log('Portal positions seen by algorithm (rounded _point):');
for (var id in portalPos) console.log('  ' + id + ' = (' + portalPos[id] + ')   true latlng=(' + trueLL[id] + ')');
console.log();

// Existing link A-C: endpoints projected unrounded
var existingAC = { a: project(trueLL.A), b: project(trueLL.C), aId: 'A', bId: 'C' };
console.log('Existing link A-C as seen by algorithm: a=(' + existingAC.a + ') b=(' + existingAC.b + ')');
console.log();

// Build candidate B-E1 with the rounded portal positions
var cand = { a: portalPos.B, b: portalPos.E1, aId: 'B', bId: 'E1' };
console.log('Candidate B-E1: a=(' + cand.a + ') b=(' + cand.b + ')');

// CCW values
var d1 = ccw(existingAC.a[0], existingAC.a[1], existingAC.b[0], existingAC.b[1], cand.a[0], cand.a[1]);
var d2 = ccw(existingAC.a[0], existingAC.a[1], existingAC.b[0], existingAC.b[1], cand.b[0], cand.b[1]);
console.log('\nccw(A,C,B_rounded) = ' + d1 + '  <-- B sits exactly on line A-C after rounding');
console.log('ccw(A,C,E1)        = ' + d2);
console.log('d1 * d2            = ' + d1 * d2 + '  (strict test needs < 0)');
console.log();

console.log('segmentsCross(B-E1, A-C) = ' + segmentsCross(cand, existingAC));
console.log('  Expected: true  (B-E1 should be blocked because it physically crosses A-C)');
console.log();

// Now show what happens if we DON'T round portal positions:
console.log('--- With unrounded portal positions (the fix) ---');
var portalPosUnrounded = {};
for (var id2 in trueLL) portalPosUnrounded[id2] = project(trueLL[id2]);
var candUnrounded = { a: portalPosUnrounded.B, b: portalPosUnrounded.E1, aId: 'B', bId: 'E1' };
console.log('B (unrounded) = (' + candUnrounded.a + ')');
var d1u = ccw(existingAC.a[0], existingAC.a[1], existingAC.b[0], existingAC.b[1], candUnrounded.a[0], candUnrounded.a[1]);
var d2u = ccw(existingAC.a[0], existingAC.a[1], existingAC.b[0], existingAC.b[1], candUnrounded.b[0], candUnrounded.b[1]);
console.log('ccw(A,C,B_unrounded) = ' + d1u);
console.log('ccw(A,C,E1)          = ' + d2u);
console.log('d1u * d2u            = ' + d1u * d2u);
console.log('segmentsCross(B-E1, A-C) = ' + segmentsCross(candUnrounded, existingAC));
