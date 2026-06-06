// Test harness: load a real IITC plugin .user.js in a vm with mocked Leaflet/map/window,
// run its wrapper + setup, and return the plugin namespace (incl. its _fns export).
// The mocks put pixel space == lat/lng space (project is identity), so tests reason in plain
// coordinates and distances are exact Euclidean.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkLL(lat, lng) {
  return { lat: lat, lng: lng, distanceTo: function (o) { var dx = lng - o.lng, dy = lat - o.lat; return Math.sqrt(dx * dx + dy * dy); } };
}

function makeEnv() {
  function jq() {
    var o = function () { return o; };
    ['html', 'appendTo', 'append', 'attr', 'on', 'text', 'click', 'addClass', 'removeClass', 'prop', 'val', 'select', 'toggleClass', 'remove'].forEach(function (m) { o[m] = function () { return o; }; });
    return o;
  }
  var L = {
    latLng: function (a, b) { return (a && typeof a === 'object' && 'lat' in a) ? a : mkLL(a, b); },
    point: function (x, y) { return { x: x, y: y }; },
    polyline: function () { return { addTo: function () { return this; } }; },
    marker: function () { return { addTo: function () { return this; } }; },
    divIcon: function () { return {}; },
    LayerGroup: function () {
      var layer = {
        on: function () { return layer; },
        bindTooltip: function () { return layer; },
        addTo: function () { return layer; },
        clearLayers: function () {}, addLayer: function () {}, removeLayer: function () {},
        openTooltip: function () {}, closeTooltip: function () {},
      };
      return layer;
    },
  };
  var map = {
    project: function (ll) { return { x: ll.lng, y: ll.lat }; },
    unproject: function (p) { return mkLL(p.y, p.x); },
    latLngToLayerPoint: function (ll) { return { x: ll.lng, y: ll.lat }; },
    layerPointToLatLng: function (p) { return mkLL(p.y, p.x); },
    getBounds: function () { return { contains: function () { return true; } }; },
    getZoom: function () { return 16; },
    hasLayer: function () { return false; },
    getCenter: function () { return mkLL(0, 0); },
    on: function () {}, off: function () {},
  };
  var document = {
    createElement: function () { return { appendChild: function () {}, style: {}, setAttribute: function () {}, addEventListener: function () {} }; },
    createTextNode: function () { return {}; },
    getElementById: function () { return null; },
    body: { appendChild: function () {} }, head: { appendChild: function () {} }, documentElement: { appendChild: function () {} },
  };
  var window = {
    bootPlugins: [], iitcLoaded: true, map: map,
    layerChooser: { addOverlay: function () {}, removeOverlay: function () {} },
    addHook: function () {}, removeHook: function () {},
    portals: {}, links: {}, fields: {}, dialog: function () {},
    PLAYER: { team: 'ENLIGHTENED' },
  };
  var env = { window: window, L: L, $: jq, document: document, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Math: Math, JSON: JSON, Array: Array, Object: Object, Date: Date, String: String, RegExp: RegExp };
  return env;
}

function loadPlugin(file, ns) {
  var src = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  var env = makeEnv();
  vm.createContext(env);
  vm.runInContext(src, env, { filename: file });
  if (typeof env.wrapper !== 'function') throw new Error('wrapper() not found in ' + file);
  env.wrapper({});
  var plugin = env.window.plugin[ns];
  if (!plugin) throw new Error('window.plugin.' + ns + ' not set by ' + file);
  return { plugin: plugin, env: env };
}

// A mock portal: guid + coords + optional mods. getLatLng() returns a LatLng with distanceTo.
function portal(guid, x, y, mods) {
  return { options: { guid: guid, data: { mods: mods || undefined } }, getLatLng: function () { return mkLL(y, x); } };
}

// Independent strict crossing test on lat/lng coords (ground truth for planarity).
function crosses(p1, p2, q1, q2) {
  function ccw(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }
  var d1 = ccw(q1.lng, q1.lat, q2.lng, q2.lat, p1.lng, p1.lat);
  var d2 = ccw(q1.lng, q1.lat, q2.lng, q2.lat, p2.lng, p2.lat);
  var d3 = ccw(p1.lng, p1.lat, p2.lng, p2.lat, q1.lng, q1.lat);
  var d4 = ccw(p1.lng, p1.lat, p2.lng, p2.lat, q2.lng, q2.lat);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function makeCtx(opts) {
  opts = opts || {};
  var edges = opts.edges || [];
  var pairs = opts.pairs || {};
  return { existing: { edges: edges.slice(), pairs: pairs }, accepted: edges.slice(), free: {}, assigned: {}, used: opts.used || {} };
}

module.exports = { loadPlugin, portal, mkLL, crosses, makeCtx };
