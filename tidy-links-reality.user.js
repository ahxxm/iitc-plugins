// ==UserScript==
// @author         boombuler
// @name           IITC plugin: Tidy Links Reality
// @category       Draw
// @version        0.9.0
// @description    Tidy link suggestions that respect existing in-game links, plus a "Route Plan" view that orders a walk to make them. Enable the layers from the layer chooser; Route Plan dialog in the toolbox. (former `Max Links`)
// @id             tidy-links-reality
// @namespace      https://github.com/IITC-CE/ingress-intel-total-conversion
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==


function wrapper(plugin_info) {
// ensure plugin framework is there, even if iitc is not yet loaded
if(typeof window.plugin !== 'function') window.plugin = function() {};

//PLUGIN AUTHORS: writing a plugin outside of the IITC build environment? if so, delete these lines!!
//(leaving them in place might break the 'About IITC' page or break update checks)
plugin_info.buildName = 'local';
plugin_info.dateTimeVersion = '2026-05-25';
plugin_info.pluginId = 'tidy-links-reality';
//END PLUGIN AUTHORS NOTE

/* exported setup, changelog --eslint */
/* global L -- eslint */

var changelog = [
  {
    version: '0.9.0',
    changes: [
      'Merge the route planner in as a second "Route Plan" layer + toolbox dialog sharing one link computation (was a separate plugin). ' +
      'Orders a walk over 40m action-range stops; flags links needing a return pass.',
    ],
  },
  {
    version: '0.8.0',
    changes: [
      'Respect existing in-game links: never propose a link that crosses or duplicates one. ' +
      'Constrained Delaunay (Delaunay triangulation minus edges crossing existing links) for tidy, planar suggestions. ' +
      'Outgoing-capacity-aware direction, coverage repair so border portals are not stranded, ' +
      'portal-count cap, and multi-polygon-correct shared ledger.',
    ],
  },
  { version: '0.6.4', changes: ['Fix missing library object reference'] },
  {
    version: '0.6.3',
    changes: ['Refactoring: fix eslint'],
  },
  {
    version: '0.6.2',
    changes: ['Version upgrade due to a change in the wrapper: plugin icons are now vectorized'],
  },
  {
    version: '0.6.1',
    changes: ['Version upgrade due to a change in the wrapper: added plugin icon'],
  },
];

// use own namespace for plugin
var tidyLinksReality = {};
window.plugin.tidyLinksReality = tidyLinksReality;

tidyLinksReality.VERSION = '0.9.0';

tidyLinksReality.setStatus = function (text) {
  var el = document.getElementById('tidy-links-reality-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tidy-links-reality-status';
    el.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:5000;' +
      'padding:4px 8px;background:rgba(0,0,0,0.7);color:#fff;' +
      'font:12px/1.3 monospace;border-radius:4px;pointer-events:none;max-width:60vw;';
    document.body.appendChild(el);
  }
  el.textContent = 'tidy-links-reality v' + tidyLinksReality.VERSION + ' | ' + text;
};

// Portal-count caps: over these we skip (drawing thousands of links freezes the UI).
// Scoped (inside a drawn polygon) allows more — the polygon is explicit intent.
tidyLinksReality.MAX_PORTALS_UNSCOPED = 500;
tidyLinksReality.MAX_PORTALS_SCOPED = 1500;
tidyLinksReality.MIN_ZOOM = 15; // IITC loads individual portals only at zoom >= 15

// zoom level used for projecting points between latLng and pixel coordinates. may affect precision of triangulation
tidyLinksReality.PROJECT_ZOOM = 16;

// https://leafletjs.com/reference-1.4.0.html#polyline-stroke
tidyLinksReality.STROKE_STYLE = {
  color: 'red',
  opacity: 1,
  weight: 1.5,
  dashArray: '6,4',
  interactive: false,
};

// Route view
tidyLinksReality.ACTION_RANGE = 40;      // metres: portals within this collapse to one stop
tidyLinksReality.GMAPS_MAX_STOPS = 23;   // Google Maps dir URL stays reliable up to ~25 stops
tidyLinksReality.PALETTE = ['#39f', '#f93', '#3c6', '#c6f', '#fc3', '#0cc', '#f66', '#9c3'];

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function distM(a, b) { return L.latLng(a).distanceTo(L.latLng(b)); }
function pTitle(g) {
  var p = window.portals[g], d = p && p.options && p.options.data;
  if (d && d.title) return d.title;
  if (p) { var l = p.getLatLng(); return l.lat.toFixed(4) + ',' + l.lng.toFixed(4); }
  return g.slice(0, 8);
}

var map;

tidyLinksReality.getLocations = function (limit) {
  var filters = window.plugin.drawTools && window.plugin.drawTools.getLocationFilters && window.plugin.drawTools.getLocationFilters();
  // fallback to map bounds if no drawn polygon (or no drawtools)
  if (!filters || !filters.length) {
    var bounds = map.getBounds();
    filters = [
      function (p) {
        return bounds.contains(p.getLatLng());
      },
    ];
  }

  var locationsArray = [];
  var counter = 0;
  filters.forEach(function (filter) {
    var points = [];
    for (var guid in window.portals) {
      if (limit) {
        counter++;
        if (counter > limit) {
          return;
        }
      }
      var location = window.portals[guid];
      if (filter(location)) {
        points.push(location);
      }
    }
    if (!points.length) return;
    locationsArray.push(points);
  });
  return locationsArray;
};

// Returns sign of the 2D cross product (b-a) x (c-a). Positive = c is left of a->b.
function ccw(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Strict (open) segment crossing in pixel space. Shared endpoints (by GUID or pixel proximity) are not crossings.
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

// Outgoing-link capacity per Ingress rules: 8 base, +8 per SoftBank Ultra Link mod (stackable).
// Mod data is only populated after IITC fetches portal detail; unknown -> assume base 8.
tidyLinksReality.getOutgoingCap = function (portal) {
  var cap = 8;
  var data = portal && portal.options && portal.options.data;
  var mods = data && data.mods;
  if (!mods) return cap;
  for (var i = 0; i < mods.length; i++) {
    var mod = mods[i];
    if (mod && mod.stats && mod.stats.OUTGOING_LINKS_BONUS) {
      cap += parseInt(mod.stats.OUTGOING_LINKS_BONUS, 10) || 0;
    }
  }
  return cap;
};

// outgoing links per portal guid, from window.links (origin side)
tidyLinksReality.getUsedOutgoing = function () {
  var used = {};
  for (var guid in window.links) {
    var data = window.links[guid].options && window.links[guid].options.data;
    if (data && data.oGuid) used[data.oGuid] = (used[data.oGuid] || 0) + 1;
  }
  return used;
};

// Chevrons every 30px along fromLL->toLL pointing to toLL, 20px clear of each endpoint.
tidyLinksReality.drawChevronTrail = function (fromLL, toLL, layer) {
  var fp = map.latLngToLayerPoint(fromLL);
  var tp = map.latLngToLayerPoint(toLL);
  var dx = tp.x - fp.x, dy = tp.y - fp.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  var ENDPOINT_CLEARANCE = 20;
  var SPACING = 30;
  var CHEVRON_DEPTH = 4;
  var CHEVRON_HALF = 3;
  if (len <= 2 * ENDPOINT_CLEARANCE) return;
  var ux = dx / len, uy = dy / len;
  var nx = -uy, ny = ux;
  for (var d = ENDPOINT_CLEARANCE; d <= len - ENDPOINT_CLEARANCE; d += SPACING) {
    var tipX = fp.x + ux * d, tipY = fp.y + uy * d;
    var armBaseX = tipX - ux * CHEVRON_DEPTH, armBaseY = tipY - uy * CHEVRON_DEPTH;
    var a1 = L.point(armBaseX + nx * CHEVRON_HALF, armBaseY + ny * CHEVRON_HALF);
    var a2 = L.point(armBaseX - nx * CHEVRON_HALF, armBaseY - ny * CHEVRON_HALF);
    L.polyline(
      [map.layerPointToLatLng(a1), map.layerPointToLatLng(L.point(tipX, tipY)), map.layerPointToLatLng(a2)],
      { color: 'red', opacity: 1, weight: 1.5, interactive: false }
    ).addTo(layer);
  }
};

// Live game links as constraint edges, unrounded pixel space at PROJECT_ZOOM.
// map.project (NOT latLngToLayerPoint, which ._round()s and can snap a portal onto a link's line).
tidyLinksReality.collectExistingLinks = function () {
  var edges = [];
  var pairs = {};
  var z = tidyLinksReality.PROJECT_ZOOM;
  for (var guid in window.links) {
    var link = window.links[guid];
    var lls = link.getLatLngs();
    if (!lls || lls.length < 2) continue;
    var ap = map.project(lls[0], z);
    var bp = map.project(lls[1], z);
    var data = (link.options && link.options.data) || {};
    var aId = data.oGuid || null;
    var bId = data.dGuid || null;
    edges.push({ a: [ap.x, ap.y], b: [bp.x, bp.y], aId: aId, bId: bId });
    if (aId && bId) {
      pairs[aId < bId ? aId + '|' + bId : bId + '|' + aId] = true;
    }
  }
  return { edges: edges, pairs: pairs };
};

// Delaunay triangulation (ironwallaby/delaunay, inlined; restored from git 2ebcd91).
var Delaunay = (function () {
  'use strict';
  var EPSILON = 1.0 / 1048576.0;
  function supertriangle(v) {
    var xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity, i, dx, dy, dmax, xmid, ymid;
    for (i = v.length; i--; ) {
      if (v[i][0] < xmin) xmin = v[i][0];
      if (v[i][0] > xmax) xmax = v[i][0];
      if (v[i][1] < ymin) ymin = v[i][1];
      if (v[i][1] > ymax) ymax = v[i][1];
    }
    dx = xmax - xmin; dy = ymax - ymin; dmax = Math.max(dx, dy); xmid = xmin + dx * 0.5; ymid = ymin + dy * 0.5;
    return [[xmid - 20 * dmax, ymid - dmax], [xmid, ymid + 20 * dmax], [xmid + 20 * dmax, ymid - dmax]];
  }
  function circumcircle(v, i, j, k) {
    var x1 = v[i][0], y1 = v[i][1], x2 = v[j][0], y2 = v[j][1], x3 = v[k][0], y3 = v[k][1],
      fy12 = Math.abs(y1 - y2), fy23 = Math.abs(y2 - y3), xc, yc, m1, m2, mx1, mx2, my1, my2, dx, dy;
    if (fy12 < EPSILON && fy23 < EPSILON) throw new Error('coincident points');
    if (fy12 < EPSILON) {
      m2 = -((x3 - x2) / (y3 - y2)); mx2 = (x2 + x3) / 2; my2 = (y2 + y3) / 2; xc = (x2 + x1) / 2; yc = m2 * (xc - mx2) + my2;
    } else if (fy23 < EPSILON) {
      m1 = -((x2 - x1) / (y2 - y1)); mx1 = (x1 + x2) / 2; my1 = (y1 + y2) / 2; xc = (x3 + x2) / 2; yc = m1 * (xc - mx1) + my1;
    } else {
      m1 = -((x2 - x1) / (y2 - y1)); m2 = -((x3 - x2) / (y3 - y2));
      mx1 = (x1 + x2) / 2; mx2 = (x2 + x3) / 2; my1 = (y1 + y2) / 2; my2 = (y2 + y3) / 2;
      xc = (m1 * mx1 - m2 * mx2 + my2 - my1) / (m1 - m2);
      yc = fy12 > fy23 ? m1 * (xc - mx1) + my1 : m2 * (xc - mx2) + my2;
    }
    dx = x2 - xc; dy = y2 - yc;
    return { i: i, j: j, k: k, x: xc, y: yc, r: dx * dx + dy * dy };
  }
  function dedup(edges) {
    var i, j, a, b, m, n;
    for (j = edges.length; j; ) {
      b = edges[--j]; a = edges[--j];
      for (i = j; i; ) {
        n = edges[--i]; m = edges[--i];
        if ((a === m && b === n) || (a === n && b === m)) { edges.splice(j, 2); edges.splice(i, 2); break; }
      }
    }
  }
  return {
    triangulate: function (vertices) {
      var n = vertices.length, i, j, indices, st, open, closed, edges, dx, dy, a, b, c;
      if (n < 3) return [];
      vertices = vertices.slice(0);
      indices = new Array(n);
      for (i = n; i--; ) indices[i] = i;
      indices.sort(function (i, j) { var d = vertices[j][0] - vertices[i][0]; return d !== 0 ? d : i - j; });
      st = supertriangle(vertices);
      vertices.push(st[0], st[1], st[2]);
      open = [circumcircle(vertices, n + 0, n + 1, n + 2)];
      closed = []; edges = [];
      for (i = indices.length; i--; edges.length = 0) {
        c = indices[i];
        for (j = open.length; j--; ) {
          dx = vertices[c][0] - open[j].x;
          if (dx > 0.0 && dx * dx > open[j].r) { closed.push(open[j]); open.splice(j, 1); continue; }
          dy = vertices[c][1] - open[j].y;
          if (dx * dx + dy * dy - open[j].r > EPSILON) continue;
          edges.push(open[j].i, open[j].j, open[j].j, open[j].k, open[j].k, open[j].i);
          open.splice(j, 1);
        }
        dedup(edges);
        for (j = edges.length; j; ) { b = edges[--j]; a = edges[--j]; open.push(circumcircle(vertices, a, b, c)); }
      }
      for (i = open.length; i--; ) closed.push(open[i]);
      open.length = 0;
      for (i = closed.length; i--; )
        if (closed[i].i < n && closed[i].j < n && closed[i].k < n) open.push(closed[i].i, closed[i].j, closed[i].k);
      return open;
    },
  };
})();

// Unique Delaunay edges as [squaredLen, i, j], shortest first. Empty on degenerate input.
function delaunayEdges(pts) {
  var tris;
  try { tris = Delaunay.triangulate(pts); } catch (e) { return []; }
  var seen = {}, edges = [];
  function add(i, j) {
    var key = i < j ? i + '_' + j : j + '_' + i;
    if (seen[key]) return;
    seen[key] = 1;
    var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
    edges.push([dx * dx + dy * dy, i, j]);
  }
  for (var k = 0; k < tris.length; k += 3) { add(tris[k], tris[k + 1]); add(tris[k + 1], tris[k + 2]); add(tris[k + 2], tris[k]); }
  edges.sort(function (a, b) { return a[0] - b[0]; });
  return edges;
}

// Sub-pixel jitter by index: keeps points non-coincident/non-collinear so Delaunay can't throw
// (which would zero the group). <0.1px; drawing uses original latLng so nothing visible moves.
function jitter(i) { return ((i * 2654435761 >>> 0) % 1000) / 1000 * 0.1; }

// Tidy planar links for one group: Delaunay candidates minus edges that duplicate/cross an
// existing link or have both ends at capacity, then a repair pass links any stranded portal.
// ctx shares the crossing set + capacity ledger across polygons. Returns { links, leftover }.
tidyLinksReality.plannedLinks = function (locations, ctx) {
  var n = locations.length, pts = [], ids = [], z = tidyLinksReality.PROJECT_ZOOM;
  for (var i = 0; i < n; i++) {
    var p = map.project(locations[i].getLatLng(), z);
    pts.push([p.x + jitter(2 * i), p.y + jitter(2 * i + 1)]);
    ids.push((locations[i].options && locations[i].options.guid) || null);
  }
  var existing = ctx.existing, accepted = ctx.accepted, free = ctx.free, asg = ctx.assigned, out = [], covered = {};
  function freeOf(idx) {
    var g = ids[idx];
    if (free[g] === undefined) free[g] = Math.max(0, tidyLinksReality.getOutgoingCap(locations[idx]) - (ctx.used[g] || 0));
    return free[g];
  }
  function viable(iu, iv) {
    var aId = ids[iu], bId = ids[iv];
    if (!aId || !bId) return false;
    if (existing.pairs[aId < bId ? aId + '|' + bId : bId + '|' + aId]) return false;
    if (freeOf(iu) === 0 && freeOf(iv) === 0) return false;
    var seg = { a: pts[iu], b: pts[iv], aId: aId, bId: bId };
    for (var m = 0; m < accepted.length; m++) if (segmentsCross(seg, accepted[m])) return false;
    return true;
  }
  function accept(iu, iv) {
    var fu = freeOf(iu), fv = freeOf(iv), origin, forced = false;
    if (fv === 0) { origin = iu; forced = true; }
    else if (fu === 0) { origin = iv; forced = true; }
    else if ((asg[ids[iu]] || 0) !== (asg[ids[iv]] || 0)) origin = (asg[ids[iu]] || 0) < (asg[ids[iv]] || 0) ? iu : iv;
    else if (fu !== fv) origin = fu > fv ? iu : iv;
    else origin = iu;
    var dest = origin === iu ? iv : iu, oId = ids[origin], dId = ids[dest];
    accepted.push({ a: pts[iu], b: pts[iv], aId: ids[iu], bId: ids[iv] });
    free[oId]--; asg[oId] = (asg[oId] || 0) + 1;
    covered[ids[iu]] = 1; covered[ids[iv]] = 1;
    out.push({ o: oId, d: dId, oLL: locations[origin].getLatLng(), dLL: locations[dest].getLatLng(), forced: forced });
  }

  var edges = delaunayEdges(pts);
  for (var e = 0; e < edges.length; e++) if (viable(edges[e][1], edges[e][2])) accept(edges[e][1], edges[e][2]);

  // coverage repair: shortest viable edge for each still-unlinked portal
  var leftover = 0;
  for (var i = 0; i < n; i++) {
    if (!ids[i] || covered[ids[i]]) continue;
    var bestJ = -1, bestD = Infinity;
    for (var j = 0; j < n; j++) {
      if (j === i || !ids[j]) continue;
      var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], d2 = dx * dx + dy * dy;
      if (d2 < bestD && viable(i, j)) { bestD = d2; bestJ = j; }
    }
    if (bestJ >= 0) accept(i, bestJ); else leftover++;
  }
  return { links: out, leftover: leftover };
};

tidyLinksReality.setOverflow = function (isOveflowed) {
  tidyLinksReality.layer[isOveflowed ? 'openTooltip' : 'closeTooltip']();
};

// Compute the link plan ONCE per refresh; both the links view and the route view read it.
// Caches { links, leftover, totalPortals, scoped, over } on tidyLinksReality._plan.
tidyLinksReality.computePlan = function () {
  if (map.getZoom() < tidyLinksReality.MIN_ZOOM) {
    tidyLinksReality._plan = { links: [], leftover: 0, over: { zoom: true } };
    return;
  }
  var dt = window.plugin.drawTools;
  var scoped = !!(dt && dt.getLocationFilters && dt.getLocationFilters().length);
  var locationsArray = tidyLinksReality.getLocations();
  var totalPortals = locationsArray.reduce(function (s, a) { return s + a.length; }, 0);
  var cap = scoped ? tidyLinksReality.MAX_PORTALS_SCOPED : tidyLinksReality.MAX_PORTALS_UNSCOPED;
  if (totalPortals > cap) {
    tidyLinksReality._plan = { links: [], leftover: 0, totalPortals: totalPortals, scoped: scoped, over: { count: totalPortals, cap: cap } };
    return;
  }
  var existing = tidyLinksReality.collectExistingLinks();
  // One shared crossing accumulator + capacity ledger across all drawn polygons.
  var ctx = { existing: existing, accepted: existing.edges.slice(), free: {}, assigned: {}, used: tidyLinksReality.getUsedOutgoing() };
  var links = [], leftover = 0;
  locationsArray.forEach(function (locations) {
    if (locations.length > 1) { var r = tidyLinksReality.plannedLinks(locations, ctx); links = links.concat(r.links); leftover += r.leftover; }
  });
  tidyLinksReality._plan = { links: links, leftover: leftover, totalPortals: totalPortals, scoped: scoped, existing: existing.edges.length, over: null };
};

// --- clusters + routing ---

// connected components of the undirected planned-link graph
function buildClusters(links) {
  var par = {};
  function find(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
  function union(a, b) {
    if (par[a] === undefined) par[a] = a;
    if (par[b] === undefined) par[b] = b;
    par[find(a)] = find(b);
  }
  links.forEach(function (l) { union(l.o, l.d); });
  var grp = {};
  links.forEach(function (l) {
    var r = find(l.o);
    grp[r] = grp[r] || { p: {}, l: [] };
    grp[r].p[l.o] = 1; grp[r].p[l.d] = 1; grp[r].l.push(l);
  });
  return Object.keys(grp).map(function (r) { return { portals: Object.keys(grp[r].p), links: grp[r].l }; });
}

// Route one component: portals within ACTION_RANGE collapse to one stop, then a plain TSP over
// stop centroids (no precedence → no forced backtracking). Each link is annotated forward-makeable
// (D's stop visited no later than O's) or return. Returns { seq, distance, links, returnSet }.
function routeComponent(c) {
  var guids = c.portals, ll = {};
  c.links.forEach(function (l) { ll[l.o] = l.oLL; ll[l.d] = l.dLL; });
  var par = {};
  guids.forEach(function (g) { par[g] = g; });
  function find(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
  for (var a = 0; a < guids.length; a++) for (var b = a + 1; b < guids.length; b++) {
    if (distM(ll[guids[a]], ll[guids[b]]) <= tidyLinksReality.ACTION_RANGE) par[find(guids[a])] = find(guids[b]);
  }
  var stopMap = {};
  guids.forEach(function (g) { var r = find(g); (stopMap[r] = stopMap[r] || []).push(g); });
  var stops = Object.keys(stopMap).map(function (r) {
    var gs = stopMap[r], lat = 0, lng = 0;
    gs.forEach(function (g) { lat += ll[g].lat; lng += ll[g].lng; });
    return { guids: gs, ll: L.latLng(lat / gs.length, lng / gs.length) };
  });
  var n = stops.length;
  function sd(i, j) { return distM(stops[i].ll, stops[j].ll); }
  function tot(o) { var d = 0; for (var i = 1; i < o.length; i++) d += sd(o[i - 1], o[i]); return d; }
  function nn(start) {
    var vis = {}, o = [start], cur = start;
    vis[start] = 1;
    while (o.length < n) {
      var best = -1, bd = Infinity;
      for (var i = 0; i < n; i++) { if (vis[i]) continue; var dd = sd(cur, i); if (dd < bd) { bd = dd; best = i; } }
      vis[best] = 1; o.push(best); cur = best;
    }
    return o;
  }
  var best = { o: [0], d: 0 };
  if (n >= 2) {
    var nStarts = Math.min(n, 16);
    best = null;
    for (var s = 0; s < nStarts; s++) { var o = nn(s); var d = tot(o); if (!best || d < best.d) best = { o: o, d: d }; }
    if (n >= 4 && n <= 40) {
      var r = best.o, imp = true;
      while (imp) {
        imp = false;
        for (var i = 1; i < r.length - 1; i++) for (var j = i + 1; j < r.length; j++) {
          var nr = r.slice(0, i).concat(r.slice(i, j + 1).reverse(), r.slice(j + 1));
          if (tot(nr) + 1e-6 < tot(r)) { r = nr; imp = true; }
        }
      }
      best = { o: r, d: tot(r) };
    }
  }
  var seq = best.o.map(function (i) { return stops[i]; });
  var visitPos = {};
  seq.forEach(function (st, pos) { st.guids.forEach(function (g) { visitPos[g] = pos; }); });
  var returnSet = {};
  c.links.forEach(function (l) { if (visitPos[l.d] > visitPos[l.o]) returnSet[l.o + '>' + l.d] = 1; });
  var clat = 0, clng = 0;
  seq.forEach(function (s) { clat += s.ll.lat; clng += s.ll.lng; });
  return { seq: seq, distance: best.d, links: c.links, returnSet: returnSet, centroid: L.latLng(clat / seq.length, clng / seq.length) };
}

tidyLinksReality.routeClusters = function () {
  var cl = buildClusters(tidyLinksReality._plan.links || []).map(routeComponent);
  cl.sort(function (a, b) { return b.distance - a.distance; });
  return cl;
};

tidyLinksReality.stopBadge = function (n, color) {
  return L.divIcon({
    className: 'rp-badge-wrap',
    html: '<div class="rp-stop" style="background:' + color + '">' + n + '</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
};

tidyLinksReality.CELL_PX = 150; // viewport grid cell; a cell with >1 cluster aggregates to a badge

// Bin clusters by centroid into fixed-pixel grid cells. Cells with one cluster render in full;
// cells with several collapse to one count badge (real-estate style). Zooming in spreads
// clusters into separate cells, so detail expands. Returns { detail:[cluster], cells:[{ll,routes,links}] }.
function gridBin(clusters) {
  var cell = tidyLinksReality.CELL_PX, bins = {};
  clusters.forEach(function (c) {
    var p = map.latLngToLayerPoint(c.centroid);
    var key = Math.floor(p.x / cell) + '_' + Math.floor(p.y / cell);
    (bins[key] = bins[key] || []).push(c);
  });
  var detail = [], cells = [];
  Object.keys(bins).forEach(function (k) {
    var group = bins[k];
    if (group.length === 1) { detail.push(group[0]); return; }
    var lat = 0, lng = 0, links = 0;
    group.forEach(function (c) { lat += c.centroid.lat; lng += c.centroid.lng; links += c.links.length; });
    cells.push({ ll: L.latLng(lat / group.length, lng / group.length), routes: group.length, links: links });
  });
  return { detail: detail, cells: cells };
}

function aggBadge(routes, links) {
  return L.divIcon({
    className: 'rp-badge-wrap',
    html: '<div class="rp-cell">' + routes + ' routes<br>' + links + ' links</div>',
    iconSize: [56, 30], iconAnchor: [28, 15],
  });
}

// Draw a detailed cluster: tidy links (red dash + chevron), the walk (colored line + numbered
// stops), and any return links (amber dashed).
function drawCluster(c, color, layer) {
  c.links.forEach(function (l) {
    L.polyline([l.oLL, l.dLL], tidyLinksReality.STROKE_STYLE).addTo(layer);
    tidyLinksReality.drawChevronTrail(l.oLL, l.dLL, layer);
    if (c.returnSet[l.o + '>' + l.d]) L.polyline([l.oLL, l.dLL], { color: '#fb6', opacity: 0.9, weight: 2, dashArray: '4,4', interactive: false }).addTo(layer);
  });
  var path = c.seq.map(function (s) { return s.ll; });
  if (path.length >= 2) L.polyline(path, { color: color, opacity: 0.9, weight: 3, interactive: false }).addTo(layer);
  c.seq.forEach(function (s, i) {
    L.marker(s.ll, { icon: tidyLinksReality.stopBadge(i + 1, color), interactive: false, keyboard: false }).addTo(layer);
  });
}

tidyLinksReality.gmaps = function (seq) {
  var s = seq.slice(0, tidyLinksReality.GMAPS_MAX_STOPS).map(function (st) { return st.ll.lat.toFixed(6) + ',' + st.ll.lng.toFixed(6); });
  return 'https://www.google.com/maps/dir/' + s.join('/');
};

tidyLinksReality.panelHtml = function () {
  var p = tidyLinksReality._plan, GMAX = tidyLinksReality.GMAPS_MAX_STOPS;
  var h = '<div class="rp-panel"><div class="rp-meta">v' + esc(tidyLinksReality.VERSION) + ' &middot; efficient walk &middot; ' + tidyLinksReality.ACTION_RANGE + 'm stops &middot; hack every stop</div>';
  if (!p) return h + '<p>Computing…</p></div>';
  if (p.over && p.over.zoom) return h + '<p>Zoom in to load portals (need zoom ≥ ' + tidyLinksReality.MIN_ZOOM + ').</p></div>';
  if (p.over) return h + '<p>Too many portals (' + p.over.count + ' &gt; ' + p.over.cap + '). Zoom in or draw a smaller polygon.</p></div>';
  var cl = tidyLinksReality._routeClusters || tidyLinksReality.routeClusters();
  if (!cl.length) return h + '<p>No makeable links in ' + (p.scoped ? 'the drawn polygon' : 'the current view (draw a polygon to focus)') + '.</p></div>';
  cl.forEach(function (c, ci) {
    var color = tidyLinksReality.PALETTE[ci % tidyLinksReality.PALETTE.length];
    var letter = String.fromCharCode(65 + (ci % 26));
    var byO = {};
    c.links.forEach(function (l) { (byO[l.o] = byO[l.o] || []).push(l); });
    h += '<div class="rp-cluster"><h4><span class="rp-dot" style="background:' + color + '"></span>Cluster ' + letter + ' &middot; ' + c.seq.length + ' stops &middot; ' + (c.distance / 1000).toFixed(2) + ' km</h4>';
    h += '<a href="' + esc(tidyLinksReality.gmaps(c.seq)) + '" target="_blank" rel="noopener">Open in Google Maps</a>';
    if (c.seq.length > GMAX) h += ' <span class="rp-warn">(first ' + GMAX + ' stops)</span>';
    h += '<ol class="rp-stops">';
    c.seq.forEach(function (s) {
      var hack = s.guids.map(function (g) { return esc(pTitle(g)); }).join(', ');
      var fwd = [], ret = [];
      s.guids.forEach(function (g) {
        (byO[g] || []).forEach(function (l) { if (c.returnSet[l.o + '>' + l.d]) ret.push(esc(pTitle(l.d))); else fwd.push(esc(pTitle(l.d))); });
      });
      var parts = '';
      if (fwd.length) parts += ' <span class="rp-throw">→ ' + fwd.join(', ') + '</span>';
      if (ret.length) parts += ' <span class="rp-carry">↩ return: ' + ret.join(', ') + '</span>';
      h += '<li>' + hack + parts + '</li>';
    });
    h += '</ol></div>';
  });
  if (p.leftover) h += '<div class="rp-warn">⚠ ' + p.leftover + ' portal(s) boxed in by existing links — no tidy link possible.</div>';
  return h + '</div>';
};

tidyLinksReality.openPanel = function () {
  tidyLinksReality.update();
  window.dialog({ title: 'Route Plan', id: 'plugin-route-plan', html: tidyLinksReality.panelHtml(), width: 'auto', closeCallback: function () { tidyLinksReality._dialogOpen = false; } });
  tidyLinksReality._dialogOpen = true;
};

tidyLinksReality.refreshPanel = function () {
  if (!tidyLinksReality._dialogOpen) return;
  var el = document.getElementById('plugin-route-plan');
  if (!el) { tidyLinksReality._dialogOpen = false; return; }
  el.innerHTML = tidyLinksReality.panelHtml();
};

// --- orchestration ---

tidyLinksReality.update = function () {
  tidyLinksReality.computePlan();
  var layer = tidyLinksReality.layer;
  if (map.hasLayer(layer)) {
    layer.clearLayers();
    var p = tidyLinksReality._plan;
    tidyLinksReality._routeClusters = [];
    if (p.over && p.over.zoom) {
      tidyLinksReality.setStatus('zoom in to load portals (need zoom ≥ ' + tidyLinksReality.MIN_ZOOM + ')'); tidyLinksReality.setOverflow(false);
    } else if (p.over) {
      tidyLinksReality.setStatus('too many portals (' + p.over.count + ' > ' + p.over.cap + ') — zoom in or draw a smaller polygon'); tidyLinksReality.setOverflow(true);
    } else {
      var clusters = tidyLinksReality._routeClusters = tidyLinksReality.routeClusters();
      var binned = gridBin(clusters);
      binned.detail.forEach(function (c, i) { drawCluster(c, tidyLinksReality.PALETTE[i % tidyLinksReality.PALETTE.length], layer); });
      binned.cells.forEach(function (cell) { L.marker(cell.ll, { icon: aggBadge(cell.routes, cell.links), interactive: false, keyboard: false }).addTo(layer); });
      tidyLinksReality.setStatus(
        'portals=' + (p.totalPortals || 0) + ' links=' + p.links.length + ' routes=' + clusters.length +
        ' (' + binned.detail.length + ' shown' + (binned.cells.length ? ', ' + (clusters.length - binned.detail.length) + ' in ' + binned.cells.length + ' cells' : '') + ')' +
        (p.leftover ? ' unlinked=' + p.leftover : '')
      );
      tidyLinksReality.setOverflow(false);
    }
  }
  tidyLinksReality.refreshPanel();
};

// Pure functions exposed for the test harness (test/invariants.test.js).
tidyLinksReality._fns = { segmentsCross: segmentsCross, delaunayEdges: delaunayEdges, jitter: jitter, plannedLinks: tidyLinksReality.plannedLinks, buildClusters: buildClusters, routeComponent: routeComponent, gridBin: gridBin };

function setup() {
  map = window.map;

  // Coalesce bursts of triggers (zoom emits moveend, mapDataRefreshEnd fires after tile fetch).
  var pendingTimer = null;
  tidyLinksReality.scheduleUpdate = function () {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pendingTimer = null; tidyLinksReality.update(); }, 200);
  };

  tidyLinksReality.layer = new L.LayerGroup([])
    .on('add', function () {
      tidyLinksReality.update();
      window.addHook('mapDataRefreshEnd', tidyLinksReality.scheduleUpdate);
      window.addHook('linkAdded', tidyLinksReality.scheduleUpdate);
      window.addHook('linkRemoved', tidyLinksReality.scheduleUpdate);
      window.addHook('fieldAdded', tidyLinksReality.scheduleUpdate);
      window.addHook('fieldRemoved', tidyLinksReality.scheduleUpdate);
      map.on('moveend', tidyLinksReality.scheduleUpdate);
      if (window.plugin.drawTools && window.plugin.drawTools.filterEvents) window.plugin.drawTools.filterEvents.on('changed', tidyLinksReality.scheduleUpdate);
    })
    .on('remove', function () {
      window.removeHook('mapDataRefreshEnd', tidyLinksReality.scheduleUpdate);
      window.removeHook('linkAdded', tidyLinksReality.scheduleUpdate);
      window.removeHook('linkRemoved', tidyLinksReality.scheduleUpdate);
      window.removeHook('fieldAdded', tidyLinksReality.scheduleUpdate);
      window.removeHook('fieldRemoved', tidyLinksReality.scheduleUpdate);
      map.off('moveend', tidyLinksReality.scheduleUpdate);
      if (window.plugin.drawTools && window.plugin.drawTools.filterEvents) window.plugin.drawTools.filterEvents.off('changed', tidyLinksReality.scheduleUpdate);
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    })
    .bindTooltip('Tidy Links Reality: too many portals — zoom in or draw a smaller polygon', { className: 'tidy-links-reality-error', direction: 'center' });
  tidyLinksReality.layer.getCenter = function () { return map.getCenter(); };

  window.layerChooser.addOverlay(tidyLinksReality.layer, 'Tidy Links Reality', { default: false });

  $('#toolbox').append(
    $('<a>').text('Route Plan').attr('title', 'Walking route to make the tidy link plan').on('click', function (e) { e.preventDefault(); tidyLinksReality.openPanel(); })
  );

  $('<style>')
    .html(
      '.tidy-links-reality-error{color:#F88;font-size:20px;font-weight:bold;text-align:center;' +
      'text-shadow:-1px -1px #000,1px -1px #000,-1px 1px #000,1px 1px #000;background-color:rgba(0,0,0,0.6);width:300px;border:none;}' +
      '.rp-badge-wrap{background:transparent;border:none;}' +
      '.rp-stop{width:20px;height:20px;border-radius:10px;color:#fff;font:bold 11px/20px sans-serif;text-align:center;' +
      'border:1px solid #fff;text-shadow:-1px -1px #000,1px -1px #000,-1px 1px #000,1px 1px #000;}' +
      '.rp-cell{width:56px;padding:2px 0;border-radius:4px;background:rgba(0,0,0,0.7);color:#fff;border:1px solid #9cf;' +
      'font:bold 10px/12px sans-serif;text-align:center;}' +
      '.rp-panel .rp-meta{font-size:11px;color:#888;margin-bottom:6px;}' +
      '.rp-panel .rp-cluster{margin:8px 0;border-top:1px solid #333;padding-top:6px;}' +
      '.rp-panel h4{margin:4px 0;}' +
      '.rp-dot{display:inline-block;width:10px;height:10px;border-radius:5px;margin-right:5px;vertical-align:middle;}' +
      '.rp-panel .rp-stops{margin:4px 0;padding-left:1.6em;}' +
      '.rp-panel .rp-hack{color:#9cf;}.rp-panel .rp-throw{color:#7e7;}.rp-panel .rp-carry{color:#f88;}' +
      '.rp-panel .rp-warn{color:#fb6;font-size:11px;}'
    )
    .appendTo('head');
}


setup.info = plugin_info; //add the script info data to the function as a property
if (typeof changelog !== 'undefined') setup.info.changelog = changelog;
if(!window.bootPlugins) window.bootPlugins = [];
window.bootPlugins.push(setup);
// if IITC has already booted, immediately run the 'setup' function
if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
