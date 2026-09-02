// ==UserScript==
// @id             gcj02-fix
// @name           IITC plugin: China GCJ-02 portal fix
// @category       Map Tiles
// @version        1.2.0
// @namespace      https://github.com/IITC-CE/ingress-intel-total-conversion
// @description    Shift portal/link/field coordinates from WGS-84 to GCJ-02 (火星坐标) so they align with GCJ-02 base tiles (Gaode roads/satellite, Google roads) in mainland China. Always on while the plugin is enabled; disable it in the IITC plugin list.
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==

/* exported setup --eslint */
/* global L -- eslint */

// Niantic serves portal coordinates in WGS-84 (raw GPS), but Google's map tiles for
// China are rendered in GCJ-02 ("Mars coordinates", 火星坐标), a national obfuscation
// that offsets positions by roughly 300-700 m. On intel.ingress.com this makes every
// portal, link and field appear shifted away from the underlying Google map. This
// plugin converts entity coordinates WGS-84 -> GCJ-02 at render time so they line up
// with the tiles. Nothing is sent to Niantic and cached data stays untouched.

function wrapper(plugin_info) {
  if (typeof window.plugin !== 'function') window.plugin = function() {};

  plugin_info.buildName = 'local';
  plugin_info.dateTimeVersion = '2026-09-02';
  plugin_info.pluginId = 'gcj02-fix';

  var plugin = window.plugin.gcj02Fix = function() {};

  plugin.changelog = [
    { version: '1.2.0', changes: ['Always-on: removed the toolbox toggle, stored enabled state and restore machinery; the region check alone decides what shifts'] },
    { version: '1.1.0', changes: ['Region check upgraded from bounding box to a polygon approximating Google\'s GCJ-02 tile coverage (from PRCoords, CC0); transform reorganized after PRCoords; inverse now iterates'] },
    { version: '1.0.0', changes: ['Initial version: WGS-84 -> GCJ-02 shift for portals, links and fields, with toolbox toggle'] },
  ];

  // ---------------------------------------------------------------- GCJ-02 math
  // Standard public GCJ-02 transformation, organized after PRCoords
  // (https://github.com/Artoria2e5/PRCoords, CC0/GPLv3+): distortion terms are
  // computed in metres, then converted to degrees via the local arc length of the
  // Krasovsky 1940 ellipsoid.
  var GCJ_A = 6378245.0; // semi-major axis of the Krasovsky 1940 ellipsoid
  var GCJ_EE = 0.00669342162296594323; // first eccentricity squared

  function wgs2gcj(lat, lng) {
    if (!inGcjRegion(lat, lng)) return { lat: lat, lng: lng };
    var x = lng - 105.0;
    var y = lat - 35.0;
    var dLatM = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)) +
      (2.0 * Math.sin(6.0 * x * Math.PI) + 2.0 * Math.sin(2.0 * x * Math.PI) +
       2.0 * Math.sin(y * Math.PI) + 4.0 * Math.sin(y / 3.0 * Math.PI) +
       16.0 * Math.sin(y / 12.0 * Math.PI) + 32.0 * Math.sin(y / 30.0 * Math.PI)) * 20.0 / 3.0;
    var dLngM = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)) +
      (2.0 * Math.sin(6.0 * x * Math.PI) + 2.0 * Math.sin(2.0 * x * Math.PI) +
       2.0 * Math.sin(x * Math.PI) + 4.0 * Math.sin(x / 3.0 * Math.PI) +
       15.0 * Math.sin(x / 12.0 * Math.PI) + 30.0 * Math.sin(x / 30.0 * Math.PI)) * 20.0 / 3.0;
    var radLat = lat / 180.0 * Math.PI;
    var magic = 1 - GCJ_EE * Math.pow(Math.sin(radLat), 2);
    var latArcLen = (Math.PI / 180.0) * (GCJ_A * (1 - GCJ_EE)) / Math.pow(magic, 1.5);
    var lngArcLen = (Math.PI / 180.0) * GCJ_A * Math.cos(radLat) / Math.sqrt(magic);
    return { lat: lat + dLatM / latArcLen, lng: lng + dLngM / lngArcLen };
  }

  // Region where Google serves GCJ-02-shifted tiles. Ring vertices are from
  // PRCoords js/misc/insane_is_in_china.js (CC0): a 70-point approximation of the
  // tile-shift coverage. This is a data-coverage approximation only, not a
  // representation of any territory or boundary. The ring follows the south coast
  // and traces around the two Pearl River Delta cities Google serves unshifted;
  // the island east of the strait is outside the ring; points at or south of
  // 17.75455N are cut off. Cheaper bbox rejects run first.
  // lon, lat pairs:
  var GCJ_RING = [
    114.433722, 22.064310, 114.009458, 22.182105, 113.599275, 22.121763,
    113.583463, 22.176002, 113.530900, 22.175318, 113.529542, 22.210608,
    113.613377, 22.227435, 113.938514, 22.483714, 114.043449, 22.500274,
    114.138506, 22.550640, 114.222984, 22.550960, 114.366803, 22.524255,
    115.254019, 20.235733, 121.456316, 26.504442, 123.417261, 30.355685,
    124.289197, 39.761103, 126.880509, 41.774504, 127.887261, 41.370015,
    128.214602, 41.965359, 129.698745, 42.452788, 130.766139, 42.668534,
    131.282487, 45.037051, 133.142361, 44.842986, 134.882453, 48.370596,
    132.235531, 47.785403, 130.980075, 47.804860, 130.659026, 48.968383,
    127.860252, 50.043973, 125.284310, 53.667091, 120.619316, 53.100485,
    119.403751, 50.105903, 117.070862, 49.690388, 115.586019, 47.995542,
    118.599613, 47.927785, 118.260771, 46.707335, 113.534759, 44.735134,
    112.093739, 45.001999, 111.431259, 43.489381, 105.206324, 41.809510,
    96.485703, 42.778692, 94.167961, 44.991668, 91.130430, 45.192938,
    90.694601, 47.754437, 87.356293, 49.232005, 85.375791, 48.263928,
    85.876055, 47.109272, 82.935423, 47.285727, 81.929808, 45.506317,
    79.919457, 45.108122, 79.841455, 42.178752, 73.334917, 40.076332,
    73.241805, 39.062331, 79.031902, 34.206413, 78.738395, 31.578004,
    80.715812, 30.453822, 81.821692, 30.585965, 85.501663, 28.208463,
    92.096061, 27.754241, 94.699781, 29.357171, 96.079442, 29.429559,
    98.910308, 27.140660, 97.404057, 24.494701, 99.400021, 23.168966,
    100.697449, 21.475914, 102.976870, 22.616482, 105.476997, 23.244292,
    108.565621, 20.907735, 107.730505, 18.193406, 110.669856, 17.754550,
  ];
  var RING_LONS = [];
  var RING_LATS = [];
  for (var ri = 0; ri < GCJ_RING.length; ri += 2) {
    RING_LONS.push(GCJ_RING[ri]);
    RING_LATS.push(GCJ_RING[ri + 1]);
  }

  // Point-in-ring, ray casting (pnpoly, Wm. Randolph Franklin, BSD-3).
  function pnpoly(x, y) {
    var inside = false;
    for (var i = 0, j = RING_LONS.length - 1; i < RING_LONS.length; j = i++) {
      if (((RING_LATS[i] > y) !== (RING_LATS[j] > y)) &&
          (x < (RING_LONS[j] - RING_LONS[i]) * (y - RING_LATS[i]) / (RING_LATS[j] - RING_LATS[i]) + RING_LONS[i])) {
        inside = !inside;
      }
    }
    return inside;
  }

  // True where the tile shift must be applied; identity everywhere else.
  function inGcjRegion(lat, lng) {
    if (lng < 72.004 || lng > 137.8347 || lat < 17.75455 || lat > 55.8271) return false;
    return pnpoly(lng, lat);
  }

  // ------------------------------------------------------------------ shifting
  // Uniform access to the coordinates of a portal (CircleMarker) or link/field
  // (Polyline/Polygon) layer, so one code path handles all three entity types.
  function getLatLngs(layer) {
    return typeof layer.getLatLngs === 'function' ? layer.getLatLngs() : [layer.getLatLng()];
  }
  function setLatLngs(layer, lls) {
    if (typeof layer.setLatLngs === 'function' ) layer.setLatLngs(lls);
    else layer.setLatLng(lls[0]);
  }

  // Shift one rendered layer in place. The marker doubles as the "already shifted"
  // guard, since core may re-fire hooks for a surviving marker.
  function shiftLayer(layer) {
    if (layer._gcjShifted) return;
    var orig = getLatLngs(layer);
    var shifted = [];
    var moved = false;
    for (var i = 0; i < orig.length; i++) {
      var g = wgs2gcj(orig[i].lat, orig[i].lng);
      shifted.push(L.latLng(g.lat, g.lng));
      if (g.lat !== orig[i].lat || g.lng !== orig[i].lng) moved = true;
    }
    if (!moved) return; // nothing in China: leave layer untouched and unmarked
    layer._gcjShifted = true;
    setLatLngs(layer, shifted);
  }

  function sweep(store, fn) {
    for (var guid in store) fn(store[guid]);
  }

  function shiftAll() {
    sweep(window.portals, shiftLayer);
    sweep(window.links, shiftLayer);
    sweep(window.fields, shiftLayer);
  }

  function onPortalAdded(d) { shiftLayer(d.portal); }
  function onLinkAdded(d) { shiftLayer(d.link); }
  function onFieldAdded(d) { shiftLayer(d.field); }

  // -------------------------------------------------------------------- setup
  function setup() {
    window.addHook('portalAdded', onPortalAdded);
    window.addHook('linkAdded', onLinkAdded);
    window.addHook('fieldAdded', onFieldAdded);

    // The plugin may load after the first map data was already rendered.
    shiftAll();
  }

  plugin.wgs2gcj = wgs2gcj;
  plugin.inGcjRegion = inGcjRegion;
  plugin.shiftLayer = shiftLayer;
  plugin._fns = {
    inGcjRegion: inGcjRegion,
    wgs2gcj: wgs2gcj,
    pnpoly: pnpoly,
    shiftLayer: shiftLayer,
    getLatLngs: getLatLngs,
    setLatLngs: setLatLngs,
  };

  setup.info = plugin_info;
  if (!window.bootPlugins) window.bootPlugins = [];
  window.bootPlugins.push(setup);
  if (window.iitcLoaded && typeof setup === 'function') setup();
}

var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
  info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
}
script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(info) + ');'));
(document.body || document.head || document.documentElement).appendChild(script);
