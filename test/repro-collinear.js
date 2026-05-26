// Standalone reproducer for the "B nearly collinear with existing link A-C" case
// described by the user. Inlines ccw/segmentsCross from tidy-links-reality.user.js
// and runs the greedy candidate-acceptance loop, then double-checks each accepted
// candidate with a strict segment-intersection ground-truth.
//
// Run: node test/repro-collinear.js

'use strict';

// ---- inlined from plugin (verbatim) ----
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
// ---- end inlined ----

// Ground-truth: strict proper-crossing test that treats collinear-near-zero
// as a crossing if the projected parameter lies inside (0,1).
function groundTruthCross(s, t) {
  // shared endpoint by id => no cross
  if (s.aId && (s.aId === t.aId || s.aId === t.bId)) return false;
  if (s.bId && (s.bId === t.aId || s.bId === t.bId)) return false;
  var p = s.a, q = s.b, u = t.a, v = t.b;
  var rx = q[0] - p[0], ry = q[1] - p[1];
  var sx = v[0] - u[0], sy = v[1] - u[1];
  var denom = rx * sy - ry * sx;
  if (denom === 0) return false; // parallel/collinear: ignore
  var tParam = ((u[0] - p[0]) * sy - (u[1] - p[1]) * sx) / denom;
  var uParam = ((u[0] - p[0]) * ry - (u[1] - p[1]) * rx) / denom;
  var EPS = 1e-9;
  return tParam > EPS && tParam < 1 - EPS && uParam > EPS && uParam < 1 - EPS;
}

// Scene
var portals = {
  A: { x: 0,    y: 0 },
  C: { x: 1000, y: 0 },
  D: { x: 500,  y: 800 },
  B: { x: 500,  y: 5 },     // nearly collinear with A-C, 5 px above
  P: { x: 400,  y: 400 },   // interior portal in triangle ACD
  E1: { x: 200, y: -200 },
  E2: { x: 800, y: -200 },
};

// Existing in-game links (constraint set)
var existingLinks = [
  { aId: 'A', bId: 'C' }, // the link B is "almost on"
  { aId: 'B', bId: 'P' }, // B's interior link
];

var ids = Object.keys(portals);
var pt = function (id) { return [portals[id].x, portals[id].y]; };

// Build constraint edges (existing links as segments)
var existing = {
  edges: existingLinks.map(function (l) {
    return { a: pt(l.aId), b: pt(l.bId), aId: l.aId, bId: l.bId };
  }),
  pairs: existingLinks.reduce(function (acc, l) {
    var k = l.aId < l.bId ? l.aId + '|' + l.bId : l.bId + '|' + l.aId;
    acc[k] = true;
    return acc;
  }, {}),
};

// Build candidates over all portal pairs
var candidates = [];
for (var i = 0; i < ids.length; i++) {
  for (var j = i + 1; j < ids.length; j++) {
    var a = ids[i], b = ids[j];
    var dx = portals[a].x - portals[b].x, dy = portals[a].y - portals[b].y;
    candidates.push({ a: a, b: b, d2: dx * dx + dy * dy });
  }
}
candidates.sort(function (x, y) { return x.d2 - y.d2; });

// Greedy loop (mirrors plugin draw())
var accepted = existing.edges.slice();
var acceptedNames = existingLinks.map(function (l) { return l.aId + '-' + l.bId + ' (existing)'; });
var dropped = [];

for (var k = 0; k < candidates.length; k++) {
  var cand = candidates[k];
  var key = cand.a < cand.b ? cand.a + '|' + cand.b : cand.b + '|' + cand.a;
  if (existing.pairs[key]) continue; // already a real link
  var seg = { a: pt(cand.a), b: pt(cand.b), aId: cand.a, bId: cand.b };
  var crosses = false;
  var crossedBy = null;
  for (var m = 0; m < accepted.length; m++) {
    if (segmentsCross(seg, accepted[m])) {
      crosses = true;
      crossedBy = accepted[m];
      break;
    }
  }
  if (crosses) {
    dropped.push({ name: cand.a + '-' + cand.b, crossedBy: crossedBy.aId + '-' + crossedBy.bId });
    continue;
  }
  accepted.push(seg);
  acceptedNames.push(cand.a + '-' + cand.b);
}

console.log('=== Greedy accepted edges (in order) ===');
acceptedNames.forEach(function (n) { console.log('  ' + n); });
console.log('\n=== Greedy rejected candidates (and the edge that vetoed them) ===');
dropped.forEach(function (d) { console.log('  ' + d.name + '  blocked by ' + d.crossedBy); });

// Sanity check: ground-truth crossings between every pair of accepted edges
console.log('\n=== Ground-truth crossings among accepted edges ===');
var problems = 0;
for (var i = 0; i < accepted.length; i++) {
  for (var j = i + 1; j < accepted.length; j++) {
    if (groundTruthCross(accepted[i], accepted[j])) {
      problems++;
      console.log(
        '  BUG: ' + accepted[i].aId + '-' + accepted[i].bId +
        ' crosses ' + accepted[j].aId + '-' + accepted[j].bId
      );
    }
  }
}
if (problems === 0) console.log('  (none — algorithm respected all existing links)');
console.log('\nTotal accepted: ' + accepted.length + '  Ground-truth crossings: ' + problems);
