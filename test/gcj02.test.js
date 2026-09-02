// Number tests for the GCJ-02 transform functions (plugin.gcj02Fix._fns).
// Run: node --test test/
// The plugin loads only to reach the exported pure functions; everything below is
// plain numbers. Reference vectors are pinned from PRCoords (Artoria2e5/PRCoords,
// js/PRCoords.js wgs_gcj) and its region ring (js/misc/insane_is_in_china.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPlugin } = require('./lib/harness');

const fns = loadPlugin('gcj02-fix.user.js', 'gcj02Fix').plugin._fns;
const wgs2gcj = fns.wgs2gcj;
const inGcjRegion = fns.inGcjRegion;

// [wgsLat, wgsLng, gcjLat, gcjLng, note]; gcj columns generated with PRCoords@1 wgs_gcj
const REF = [
  [39.9077, 116.3915, 39.909101380, 116.397741311, 'Beijing'],
  [31.1753, 121.5215, 31.173191083, 121.525850234, 'Shanghai'],
  [23.1291, 113.2644, 23.126423340, 113.269729592, 'Guangzhou'],
  [22.5431, 114.0579, 22.540382814, 114.063013999, 'Shenzhen'],
  [30.6598, 104.0633, 30.657375687, 104.065802770, 'Chengdu'],
  [43.8256, 87.6168, 43.826805393, 87.619649949, 'Urumqi'],
  [45.7732, 126.6577, 45.775172985, 126.663711950, 'Harbin'],
  [39.4704, 75.9898, 39.470627026, 75.992754990, 'Kashgar'],
  [29.652, 91.1721, 29.649210494, 91.173567372, 'Lhasa'],
  [18.2528, 109.5119, 18.251094792, 109.515984295, 'Sanya'],
  [24.8801, 102.8329, 24.877030776, 102.834316194, 'Kunming'],
];

// [lat, lng, inRegion, note]
const REGION = [
  [39.9077, 116.3915, true, 'Beijing'],
  [31.1753, 121.5215, true, 'Shanghai'],
  [22.5431, 114.0579, true, 'Shenzhen, just north of the delta notch'],
  [43.8256, 87.6168, true, 'Urumqi'],
  [45.7732, 126.6577, true, 'Harbin'],
  [18.2528, 109.5119, true, 'Sanya, just north of the sea cut-off'],
  [22.28, 114.16, false, 'Pearl River Delta city served unshifted'],
  [22.19, 113.54, false, 'other delta city served unshifted'],
  [25.033, 121.5654, false, 'island east of the strait'],
  [37.5665, 126.978, false, 'Seoul'],
  [35.6895, 139.6917, false, 'Tokyo'],
  [47.8864, 106.9057, false, 'Ulaanbaatar'],
  [39.0392, 125.7625, false, 'Pyongyang'],
  [21.0278, 105.8342, false, 'Hanoi'],
  [15.0, 114.0, false, 'south of the sea cut-off'],
  [51.5074, -0.1278, false, 'London, also outside the bbox fast path'],
];

function metersBetween(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos((a.lat / 180) * Math.PI);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

test('N1 forward transform reproduces the PRCoords reference vectors', () => {
  REF.forEach(function (r) {
    const g = wgs2gcj(r[0], r[1]);
    assert.ok(Math.abs(g.lat - r[2]) < 1e-9 && Math.abs(g.lng - r[3]) < 1e-9,
      r[4] + ': got ' + g.lat + ',' + g.lng + ', want ' + r[2] + ',' + r[3]);
  });
});

test('N2 shift magnitude is the known few-hundred-metre offset', () => {
  REF.forEach(function (r) {
    const m = metersBetween({ lat: r[0], lng: r[1] }, wgs2gcj(r[0], r[1]));
    // the distortion function stays in the 250-650m range across the whole region
    assert.ok(m > 200 && m < 800, r[4] + ': offset ' + m.toFixed(0) + 'm outside the plausible band');
  });
});

test('N3 region check matches the PRCoords ring membership table', () => {
  REGION.forEach(function (r) {
    assert.strictEqual(inGcjRegion(r[0], r[1]), r[2], r[3]);
  });
});

test('N4 identity outside the region: foreign coordinates pass through untouched', () => {
  REGION.filter(function (r) { return !r[2]; }).forEach(function (r) {
    const g = wgs2gcj(r[0], r[1]);
    assert.strictEqual(g.lat, r[0], r[3] + ': lat moved');
    assert.strictEqual(g.lng, r[1], r[3] + ': lng moved');
  });
});
