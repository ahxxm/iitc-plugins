// ==UserScript==
// @author         boombuler
// @name           IITC plugin: Tidy Links Reality
// @category       Draw
// @version        0.7.2
// @description    Calculate how to link the portals to create a reasonably tidy set of links/fields. Enable from the layer chooser. (former `Max Links`)
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
    version: '0.7.0',
    changes: [
      'Respect existing in-game links: never propose a link that crosses or duplicates one. ' +
      'Replace Delaunay with greedy shortest-edge insertion against existing links and earlier accepted candidates.',
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

tidyLinksReality.VERSION = '0.7.2';

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

tidyLinksReality.MAX_PORTALS_TO_LINK = 200; // N.B.: this limit is not about performance

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

// Count current outgoing links per portal guid by scanning window.links (origin side).
tidyLinksReality.getUsedOutgoing = function () {
  var used = {};
  for (var guid in window.links) {
    var data = window.links[guid].options && window.links[guid].options.data;
    if (data && data.oGuid) used[data.oGuid] = (used[data.oGuid] || 0) + 1;
  }
  return used;
};

// Draw a trail of small chevrons along fromLL->toLL, all pointing toward toLL.
// Each chevron is ~6 px wide, 4 px deep. Chevrons are spaced every 30 px along the
// segment, with a 20 px clearance from each endpoint so portal markers stay readable.
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

// Collect every live game link as a constraint edge in unrounded pixel space at PROJECT_ZOOM.
// link.getLatLngs() returns [fromLatLng, toLatLng] for IITC link layers (see cross-links plugin).
// Use map.project(ll, zoom) NOT latLngToLayerPoint(ll) — the latter calls ._round() inside Leaflet,
// which can snap near-collinear portals onto an existing link's line and defeat the ccw test.
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

// Returns { drawn, forced, preferred, skipped } counts. Every accepted candidate
// gets one arrowhead (uniform style); direction is the walking-route recommendation.
tidyLinksReality.draw = function (locations, layer, existing, usedOutgoing) {
  var drawnCount = 0;
  var forcedCount = 0;
  var preferredCount = 0;
  var skippedSaturated = 0;
  var n = locations.length;
  var pts = new Array(n);
  var ids = new Array(n);
  var free = new Array(n);     // remaining outgoing capacity per local index
  var assigned = new Array(n); // new outgoing committed this batch (for load-spreading)
  // Project at PROJECT_ZOOM with map.project (unrounded). Reading locations[i]._point
  // or using latLngToLayerPoint both round to integer pixels, which can snap a
  // near-collinear portal exactly onto an existing link's line and defeat the ccw test.
  var z = tidyLinksReality.PROJECT_ZOOM;
  for (var i = 0; i < n; i++) {
    var p = map.project(locations[i].getLatLng(), z);
    pts[i] = [p.x, p.y];
    var gid = (locations[i].options && locations[i].options.guid) || null;
    ids[i] = gid;
    var cap = tidyLinksReality.getOutgoingCap(locations[i]);
    var used = (gid && usedOutgoing[gid]) || 0;
    free[i] = Math.max(0, cap - used);
    assigned[i] = 0;
  }

  var candidates = [];
  for (var u = 0; u < n; u++) {
    for (var v = u + 1; v < n; v++) {
      var dx = pts[u][0] - pts[v][0];
      var dy = pts[u][1] - pts[v][1];
      candidates.push([dx * dx + dy * dy, u, v]);
    }
  }
  candidates.sort(function (x, y) { return x[0] - y[0]; });

  var accepted = existing.edges.slice();
  for (var k = 0; k < candidates.length; k++) {
    var iu = candidates[k][1];
    var iv = candidates[k][2];
    var aId = ids[iu];
    var bId = ids[iv];
    if (aId && bId) {
      var key = aId < bId ? aId + '|' + bId : bId + '|' + aId;
      if (existing.pairs[key]) continue;
    }
    var seg = { a: pts[iu], b: pts[iv], aId: aId, bId: bId };
    var crosses = false;
    for (var m = 0; m < accepted.length; m++) {
      if (segmentsCross(seg, accepted[m])) { crosses = true; break; }
    }
    if (crosses) continue;

    var fu = free[iu], fv = free[iv];
    if (fu === 0 && fv === 0) {
      skippedSaturated++;
      continue;
    }

    // Origin choice:
    //   - if exactly one side has free=0, the other is forced.
    //   - otherwise, prefer the side with FEWER outgoing already assigned this batch
    //     (spreads key load across portals); tiebreak by larger free; final tie by index.
    var origin;
    var forced = false;
    if (fv === 0) {
      origin = iu;
      forced = true;
    } else if (fu === 0) {
      origin = iv;
      forced = true;
    } else if (assigned[iu] !== assigned[iv]) {
      origin = assigned[iu] < assigned[iv] ? iu : iv;
    } else if (fu !== fv) {
      origin = fu > fv ? iu : iv;
    } else {
      origin = iu;
    }
    var dest = origin === iu ? iv : iu;

    accepted.push(seg);
    var fromLL = locations[origin].getLatLng();
    var toLL = locations[dest].getLatLng();
    L.polyline([fromLL, toLL], tidyLinksReality.STROKE_STYLE).addTo(layer);
    tidyLinksReality.drawChevronTrail(fromLL, toLL, layer);
    free[origin]--;
    assigned[origin]++;
    drawnCount++;
    if (forced) forcedCount++; else preferredCount++;
  }
  return { drawn: drawnCount, forced: forcedCount, preferred: preferredCount, skipped: skippedSaturated };
};

tidyLinksReality.setOverflow = function (isOveflowed) {
  tidyLinksReality.layer[isOveflowed ? 'openTooltip' : 'closeTooltip']();
};

tidyLinksReality.update = function () {
  var locationsArray = tidyLinksReality.getLocations();
  var totalPortals = locationsArray.reduce(function (s, a) { return s + a.length; }, 0);
  if (locationsArray.length) {
    tidyLinksReality.layer.clearLayers();
    var existing = tidyLinksReality.collectExistingLinks();
    var used = tidyLinksReality.getUsedOutgoing();
    var totals = { drawn: 0, forced: 0, preferred: 0, skipped: 0 };
    locationsArray.forEach(function (locations) {
      var r = tidyLinksReality.draw(locations, tidyLinksReality.layer, existing, used);
      totals.drawn += r.drawn;
      totals.forced += r.forced;
      totals.preferred += r.preferred;
      totals.skipped += r.skipped;
    });
    tidyLinksReality.setStatus(
      'portals=' + totalPortals + ' existing=' + existing.edges.length +
      ' drawn=' + totals.drawn + ' (' + totals.forced + ' forced, ' + totals.preferred + ' preferred) skipped=' + totals.skipped
    );
  } else {
    tidyLinksReality.setStatus('portals=0 (no portals in view)');
  }
  tidyLinksReality.setOverflow(!locationsArray.length);
};

function setup() {
  map = window.map;

  // Coalesce bursts of triggers (zoom emits moveend, mapDataRefreshEnd fires after tile fetch).
  var pendingTimer = null;
  tidyLinksReality.scheduleUpdate = function () {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      tidyLinksReality.update();
    }, 200);
  };

  tidyLinksReality.layer = new L.LayerGroup([])
    .on('add', function () {
      tidyLinksReality.update();
      window.addHook('mapDataRefreshEnd', tidyLinksReality.scheduleUpdate);
      window.addHook('portalDetailLoaded', tidyLinksReality.scheduleUpdate);
      map.on('moveend', tidyLinksReality.scheduleUpdate);
      if (window.plugin.drawTools && window.plugin.drawTools.filterEvents) {
        window.plugin.drawTools.filterEvents.on('changed', tidyLinksReality.scheduleUpdate);
      }
    })
    .on('remove', function () {
      window.removeHook('mapDataRefreshEnd', tidyLinksReality.scheduleUpdate);
      window.removeHook('portalDetailLoaded', tidyLinksReality.scheduleUpdate);
      map.off('moveend', tidyLinksReality.scheduleUpdate);
      if (window.plugin.drawTools && window.plugin.drawTools.filterEvents) {
        window.plugin.drawTools.filterEvents.off('changed', tidyLinksReality.scheduleUpdate);
      }
    })
    .bindTooltip('Tidy Links Reality: too many portals!', {
      className: 'tidy-links-reality-error',
      direction: 'center',
    });
  tidyLinksReality.layer.getCenter = function () {
    // for tooltip position
    return map.getCenter();
  };

  window.layerChooser.addOverlay(tidyLinksReality.layer, 'Tidy Links Reality v' + tidyLinksReality.VERSION, { default: false });

  $('<style>')
    .html(
      '\
    .tidy-links-reality-error {\
      color: #F88;\
      font-size: 20px;\
      font-weight: bold;\
      text-align: center;\
      text-shadow: -1px -1px #000, 1px -1px #000, -1px 1px #000, 1px 1px #000;\
      background-color: rgba(0,0,0,0.6);\
      width: 300px;\
      border: none;\
    }\
  '
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
