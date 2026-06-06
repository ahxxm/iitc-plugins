// Invariant tests for the link/route logic. Run: node --test test/
// Each invariant maps to a regression we actually hit.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPlugin, portal, mkLL, crosses, makeCtx } = require('./lib/harness');

const tidy = loadPlugin('tidy-links-reality.user.js', 'tidyLinksReality').plugin;

// existing-link edge in the accepted[] format (pixel space == lat/lng here: x=lng, y=lat)
function wall(x1, y1, x2, y2, aId, bId) {
  return { a: [x1, y1], b: [x2, y2], aId: aId || null, bId: bId || null };
}
function endpoints(link) { return { o: link.oLL, d: link.dLL }; }
function anyCross(links) {
  for (var i = 0; i < links.length; i++) for (var j = i + 1; j < links.length; j++) {
    var A = endpoints(links[i]), B = endpoints(links[j]);
    if (crosses(A.o, A.d, B.o, B.d)) return [i, j];
  }
  return null;
}

// a deterministic spread of portals
function cloud() {
  return [
    portal('A', 0, 0), portal('B', 100, 10), portal('C', 60, 90),
    portal('D', 50, 40), portal('E', 120, 70), portal('F', 20, 80),
  ];
}

test('I1 planarity: no two planned links cross (tidy)', () => {
  var r = tidy.plannedLinks(cloud(), makeCtx());
  assert.ok(r.links.length > 0, 'expected links');
  assert.strictEqual(anyCross(r.links), null, 'two planned links cross');
});

test('I2 existing links respected: nothing crosses a wall', () => {
  // left {A,F,D-ish} vs right {B,C,E}; vertical wall at x=55
  var locs = [portal('A', 0, 0), portal('F', 20, 80), portal('B', 100, 0), portal('C', 100, 90), portal('E', 120, 40)];
  var ctx = makeCtx({ edges: [wall(55, -100, 55, 200, 'W1', 'W2')] });
  var r = tidy.plannedLinks(locs, ctx);
  r.links.forEach(function (l) {
    assert.ok(crosses(l.oLL, l.dLL, mkLL(-100, 55), mkLL(200, 55)) === false, 'a planned link crosses the wall');
  });
});

test('I2b unrounded crossing: a sub-pixel-off point still detects its crossing', () => {
  // B sits 0.49 above line A-C; integer rounding (the old _point bug) would put it ON the line
  // (ccw 0) and miss that B->E1 crosses A-C. With unrounded coords segmentsCross must see it.
  var seg = { a: [500, 0.49], b: [200, -200], aId: 'B', bId: 'E1' };
  var ac = { a: [0, 0], b: [1000, 0], aId: 'A', bId: 'C' };
  assert.strictEqual(tidy._fns.segmentsCross(seg, ac), true, 'sub-pixel crossing missed (rounding regression)');
});

test('I3 non-degeneracy: jitter rescues a degenerate (collinear) point set', () => {
  // A horizontal collinear row triangulates to nothing (degenerate) — delaunayEdges returns [].
  var line = [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]];
  assert.strictEqual(tidy._fns.delaunayEdges(line).length, 0, 'expected collinear row to be degenerate');
  // The jitter the plugin applies before triangulating must make it non-degenerate.
  var jittered = line.map(function (p, i) { return [p[0] + tidy._fns.jitter(2 * i), p[1] + tidy._fns.jitter(2 * i + 1)]; });
  assert.ok(tidy._fns.delaunayEdges(jittered).length > 0, 'jitter failed to rescue a collinear set');
});

test('I3b coverage survives a degenerate group end to end', () => {
  // Collinear portals through plannedLinks must still produce links (jitter + repair together).
  var locs = [portal('A', 0, 0), portal('B', 10, 0), portal('C', 20, 0), portal('D', 30, 0)];
  var r = tidy.plannedLinks(locs, makeCtx());
  assert.ok(r.links.length > 0, 'degenerate group produced no links');
  assert.strictEqual(r.leftover, 0, 'degenerate group stranded portals');
});

test('I4 coverage: no existing links + ample capacity strands no portal', () => {
  var locs = cloud();
  var r = tidy.plannedLinks(locs, makeCtx());
  assert.strictEqual(r.leftover, 0, 'a portal was left unlinked with no obstacles');
  var covered = {};
  r.links.forEach(function (l) { covered[l.o] = 1; covered[l.d] = 1; });
  locs.forEach(function (p) { assert.ok(covered[p.options.guid], 'portal ' + p.options.guid + ' has no link'); });
});

test('I5 capacity: no origin exceeds its outgoing cap across shared multi-group ledger', () => {
  var ctx = makeCtx();
  var g1 = [portal('A', 0, 0), portal('B', 10, 0), portal('C', 0, 10), portal('D', 10, 10), portal('E', 5, 5)];
  var g2 = [portal('E', 5, 5), portal('F', 20, 5), portal('G', 5, 20), portal('H', 20, 20)]; // shares E
  var out = tidy.plannedLinks(g1, ctx).links.concat(tidy.plannedLinks(g2, ctx).links);
  var outgoing = {};
  out.forEach(function (l) { outgoing[l.o] = (outgoing[l.o] || 0) + 1; });
  Object.keys(outgoing).forEach(function (g) { assert.ok(outgoing[g] <= 8, g + ' has ' + outgoing[g] + ' outgoing > cap 8'); });
});

test('I6 route: stops once, returnSet correct, collinear has no backtrack', () => {
  var locs = [portal('A', 0, 0), portal('B', 100, 0), portal('C', 200, 0)];
  var links = tidy.plannedLinks(locs, makeCtx()).links;
  var comps = tidy._fns.buildClusters(links);
  assert.strictEqual(comps.length, 1, 'expected one component');
  var rc = tidy._fns.routeComponent(comps[0]);
  // every portal appears in exactly one stop
  var seen = {};
  rc.seq.forEach(function (s) { s.guids.forEach(function (g) { assert.ok(!seen[g]); seen[g] = 1; }); });
  assert.deepStrictEqual(Object.keys(seen).sort(), ['A', 'B', 'C']);
  // collinear 0-100-200: efficient walk is 200, no backtrack
  assert.ok(Math.abs(rc.distance - 200) < 1e-6, 'route distance ' + rc.distance + ' != 200 (backtrack)');
  // returnSet only flags links whose destination stop comes later
  var pos = {};
  rc.seq.forEach(function (s, i) { s.guids.forEach(function (g) { pos[g] = i; }); });
  links.forEach(function (l) {
    var later = pos[l.d] > pos[l.o];
    assert.strictEqual(!!rc.returnSet[l.o + '>' + l.d], later, 'returnSet wrong for ' + l.o + '->' + l.d);
  });
});

test('I6b route: 40m action range collapses a dense block to one stop', () => {
  // four portals within 40m + links among them
  var locs = [portal('A', 0, 0), portal('B', 10, 0), portal('C', 0, 10), portal('D', 10, 10)];
  var links = tidy.plannedLinks(locs, makeCtx()).links;
  var comps = tidy._fns.buildClusters(links);
  var rc = tidy._fns.routeComponent(comps[0]);
  assert.strictEqual(rc.seq.length, 1, 'dense <40m block should be one stop');
  assert.strictEqual(Object.keys(rc.returnSet).length, 0, 'intra-stop links should all be forward');
});

test('I8 grid aggregation: co-located clusters collapse to one cell, far ones stay detailed', () => {
  // mock projection is identity (x=lng, y=lat); CELL_PX=150 → same 150-unit cell aggregates
  function cl(lat, lng, nlinks) {
    var links = []; for (var i = 0; i < nlinks; i++) links.push({ o: 'o', d: 'd' });
    return { centroid: mkLL(lat, lng), links: links, seq: [], returnSet: {} };
  }
  var clusters = [cl(0, 0, 3), cl(10, 10, 2), cl(20, 5, 4), cl(900, 900, 5)]; // first three share a cell, last is far
  var binned = tidy._fns.gridBin(clusters);
  assert.strictEqual(binned.detail.length, 1, 'the lone far cluster should render in detail');
  assert.strictEqual(binned.cells.length, 1, 'the three co-located clusters should collapse to one cell');
  assert.strictEqual(binned.cells[0].routes, 3, 'cell should count 3 routes');
  assert.strictEqual(binned.cells[0].links, 9, 'cell should sum 3+2+4 = 9 links');
});

test('I7 determinism: same input yields identical output', () => {
  var key = function (l) { return l.o + '>' + l.d; };
  var a = tidy.plannedLinks(cloud(), makeCtx()).links.map(key).join('|');
  var b = tidy.plannedLinks(cloud(), makeCtx()).links.map(key).join('|');
  assert.strictEqual(a, b);
});
