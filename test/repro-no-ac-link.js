// Variant: same geometry but A-C is NOT a game link. Only B-P is existing.
// Tests whether the algorithm's own candidate ordering still happens to avoid
// the "B-E1 crosses line A-C" situation, or whether B-E1 gets drawn freely.

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

var portals = {
  A: { x: 0,    y: 0 },
  C: { x: 1000, y: 0 },
  D: { x: 500,  y: 800 },
  B: { x: 500,  y: 5 },
  P: { x: 400,  y: 400 },
  E1: { x: 200, y: -200 },
  E2: { x: 800, y: -200 },
};

// Only B-P is an existing game link. No A-C constraint.
var existingLinks = [{ aId: 'B', bId: 'P' }];

var ids = Object.keys(portals);
var pt = function (id) { return [portals[id].x, portals[id].y]; };

var existing = {
  edges: existingLinks.map(function (l) { return { a: pt(l.aId), b: pt(l.bId), aId: l.aId, bId: l.bId }; }),
  pairs: existingLinks.reduce(function (acc, l) {
    var k = l.aId < l.bId ? l.aId + '|' + l.bId : l.bId + '|' + l.aId;
    acc[k] = true;
    return acc;
  }, {}),
};

var candidates = [];
for (var i = 0; i < ids.length; i++) {
  for (var j = i + 1; j < ids.length; j++) {
    var a = ids[i], b = ids[j];
    var dx = portals[a].x - portals[b].x, dy = portals[a].y - portals[b].y;
    candidates.push({ a: a, b: b, d2: dx * dx + dy * dy });
  }
}
candidates.sort(function (x, y) { return x.d2 - y.d2; });

var accepted = existing.edges.slice();
var acceptedNames = existingLinks.map(function (l) { return l.aId + '-' + l.bId + ' (existing)'; });

for (var k = 0; k < candidates.length; k++) {
  var cand = candidates[k];
  var key = cand.a < cand.b ? cand.a + '|' + cand.b : cand.b + '|' + cand.a;
  if (existing.pairs[key]) continue;
  var seg = { a: pt(cand.a), b: pt(cand.b), aId: cand.a, bId: cand.b };
  var crosses = false;
  for (var m = 0; m < accepted.length; m++) {
    if (segmentsCross(seg, accepted[m])) { crosses = true; break; }
  }
  if (crosses) continue;
  accepted.push(seg);
  acceptedNames.push(cand.a + '-' + cand.b);
}

console.log('Accepted edges (A-C is NOT a game link):');
acceptedNames.forEach(function (n) { console.log('  ' + n); });
console.log('\nIs B-E1 drawn? ' + (acceptedNames.indexOf('B-E1') >= 0));
console.log('Is B-E2 drawn? ' + (acceptedNames.indexOf('B-E2') >= 0));
console.log('Is A-C drawn? ' + (acceptedNames.indexOf('A-C') >= 0));
