// ==UserScript==
// @author         hi
// @name           IITC plugin: AP Targets
// @category       Info
// @version        0.1.0
// @description    Rank top-10 enemy portals in viewport by cascade destruction AP (incident links + fields). No portal-detail tap needed.
// @id             ap-targets
// @namespace      https://github.com/IITC-CE/ingress-intel-total-conversion
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==


function wrapper(plugin_info) {
// ensure plugin framework is there, even if iitc is not yet loaded
if(typeof window.plugin !== 'function') window.plugin = function() {};

plugin_info.buildName = 'local';
plugin_info.dateTimeVersion = '2026-05-27';
plugin_info.pluginId = 'ap-targets';

/* exported setup --eslint */
/* global L -- eslint */

var apTargets = {};
window.plugin.apTargets = apTargets;

apTargets.VERSION = '0.1.0';
apTargets.TOP_N = 10;
apTargets.AP_PER_LINK = 187;
apTargets.AP_PER_FIELD = 750;
apTargets.STORAGE_KEY = 'ap-targets-my-team';

apTargets._lastResult = null;
apTargets._dialogOpen = false;

var map;

apTargets.normalizeTeam = function (t) {
  if (!t) return null;
  var c = String(t).charAt(0).toUpperCase();
  if (c === 'R' || c === 'E' || c === 'M' || c === 'N') return c;
  return null;
};

// Session flag set when the user declines the prompt; suppresses re-prompting until reload.
apTargets._promptDeclined = false;

apTargets.getMyTeam = function () {
  var stored = apTargets.normalizeTeam(localStorage.getItem(apTargets.STORAGE_KEY));
  if (stored) return stored;
  if (window.PLAYER && window.PLAYER.team) {
    var t = apTargets.normalizeTeam(window.PLAYER.team);
    if (t) {
      localStorage.setItem(apTargets.STORAGE_KEY, t);
      return t;
    }
  }
  if (apTargets._promptDeclined) return null;
  var ans = window.prompt('AP Targets: enter your faction (R = Resistance, E = Enlightened, M = Machina)', 'R');
  var nt = apTargets.normalizeTeam(ans);
  if (nt) {
    localStorage.setItem(apTargets.STORAGE_KEY, nt);
    return nt;
  }
  apTargets._promptDeclined = true;
  return null;
};

apTargets.escapeHtml = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

apTargets.makeBadge = function (rank, ap) {
  var html =
    '<div class="ap-targets-badge">' +
    '<div class="ap-targets-rank">' + rank + '</div>' +
    '<div class="ap-targets-ap">' + ap + '</div>' +
    '</div>';
  return L.divIcon({
    className: 'ap-targets-badge-wrap',
    html: html,
    iconSize: [32, 40],
    iconAnchor: [16, 20],
  });
};

// Build a short coord label for placeholder portals (no detail tap yet → no title).
apTargets.coordLabel = function (latLng) {
  return latLng.lat.toFixed(4) + ',' + latLng.lng.toFixed(4);
};

// One pass over links + fields to count incidence per portal guid, then rank portals in viewport.
// Takes myTeam so the caller (render) can compute it once per cycle.
apTargets.rank = function (myTeam) {
  var linkCount = {};
  for (var lguid in window.links) {
    var ld = window.links[lguid].options && window.links[lguid].options.data;
    if (!ld) continue;
    if (ld.oGuid) linkCount[ld.oGuid] = (linkCount[ld.oGuid] || 0) + 1;
    if (ld.dGuid) linkCount[ld.dGuid] = (linkCount[ld.dGuid] || 0) + 1;
  }
  var fieldCount = {};
  for (var fguid in window.fields) {
    var fd = window.fields[fguid].options && window.fields[fguid].options.data;
    if (!fd || !fd.points) continue;
    for (var i = 0; i < fd.points.length; i++) {
      var v = fd.points[i];
      if (v && v.guid) fieldCount[v.guid] = (fieldCount[v.guid] || 0) + 1;
    }
  }

  var bounds = map.getBounds();
  var scored = [];
  for (var pguid in window.portals) {
    var portal = window.portals[pguid];
    var ll = portal.getLatLng();
    if (!bounds.contains(ll)) continue;
    var pd = portal.options && portal.options.data;
    if (!pd) continue;
    var team = apTargets.normalizeTeam(pd.team);
    if (!team || team === 'N') continue;
    if (team === myTeam) continue;
    var lc = linkCount[pguid] || 0;
    var fc = fieldCount[pguid] || 0;
    var ap = apTargets.AP_PER_LINK * lc + apTargets.AP_PER_FIELD * fc;
    if (ap === 0) continue;
    scored.push({
      guid: pguid,
      ap: ap,
      links: lc,
      fields: fc,
      team: team,
      title: pd.title || apTargets.coordLabel(ll),
      hasTitle: !!pd.title,
      latLng: ll,
    });
  }
  scored.sort(function (a, b) { return b.ap - a.ap; });
  return scored.slice(0, apTargets.TOP_N);
};

// compute() refreshes the cached ranked list. Called by both the layer (for badges)
// and the on-demand panel (so the dialog can fetch fresh data when opened).
apTargets.compute = function () {
  var myTeam = apTargets.getMyTeam();
  if (!myTeam) {
    apTargets._lastResult = { myTeam: null, top: [] };
    return apTargets._lastResult;
  }
  apTargets._lastResult = { myTeam: myTeam, top: apTargets.rank(myTeam) };
  return apTargets._lastResult;
};

apTargets.renderBadges = function () {
  apTargets.layer.clearLayers();
  var r = apTargets._lastResult || { top: [] };
  for (var i = 0; i < r.top.length; i++) {
    var t = r.top[i];
    L.marker(t.latLng, {
      icon: apTargets.makeBadge(i + 1, t.ap),
      interactive: false,
      keyboard: false,
    }).addTo(apTargets.layer);
  }
};

// render() is the per-event entry point: recompute + redraw badges + refresh the
// dialog if it's currently open. Used by all the debounced hooks.
apTargets.render = function () {
  apTargets.compute();
  apTargets.renderBadges();
  apTargets._refreshPanel();
};

apTargets._panelHtml = function () {
  var r = apTargets._lastResult || { myTeam: null, top: [] };
  var html = '<div class="ap-targets-panel">';
  html += '<div class="apt-meta">v' + apTargets.escapeHtml(apTargets.VERSION) + ' &middot; vs ' + (r.myTeam ? apTargets.escapeHtml(r.myTeam) : '<em>(faction not set)</em>') + '</div>';
  if (!r.myTeam) {
    html += '<p>Reload the page to retry the faction prompt, or set <code>localStorage["' + apTargets.escapeHtml(apTargets.STORAGE_KEY) + '"]</code> to <code>R</code>, <code>E</code>, or <code>M</code>.</p>';
  } else if (r.top.length === 0) {
    html += '<p>No enemy portals with incident links or fields in the current viewport.</p>';
  } else {
    html += '<table class="apt-table"><thead><tr>' +
      '<th>#</th><th>AP</th><th>Links</th><th>Fields</th><th>Portal</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < r.top.length; i++) {
      var t = r.top[i];
      var title = apTargets.escapeHtml(t.title);
      if (!t.hasTitle) title = '<em>' + title + '</em>';
      html += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + t.ap + '</td>' +
        '<td>' + t.links + '</td>' +
        '<td>' + t.fields + '</td>' +
        '<td>' + title + '</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
  }
  html += '</div>';
  return html;
};

apTargets.openPanel = function () {
  apTargets.compute();
  window.dialog({
    title: 'AP Targets',
    id: 'plugin-ap-targets',
    html: apTargets._panelHtml(),
    width: 'auto',
    closeCallback: function () { apTargets._dialogOpen = false; },
  });
  apTargets._dialogOpen = true;
};

apTargets._refreshPanel = function () {
  if (!apTargets._dialogOpen) return;
  var el = document.getElementById('plugin-ap-targets');
  if (!el) { apTargets._dialogOpen = false; return; }
  el.innerHTML = apTargets._panelHtml();
};

function setup() {
  map = window.map;

  var pendingTimer = null;
  apTargets.scheduleUpdate = function () {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      apTargets.render();
    }, 200);
  };

  apTargets.layer = new L.LayerGroup([])
    .on('add', function () {
      apTargets.render();
      window.addHook('mapDataRefreshEnd', apTargets.scheduleUpdate);
      window.addHook('linkAdded', apTargets.scheduleUpdate);
      window.addHook('linkRemoved', apTargets.scheduleUpdate);
      window.addHook('fieldAdded', apTargets.scheduleUpdate);
      window.addHook('fieldRemoved', apTargets.scheduleUpdate);
      map.on('moveend', apTargets.scheduleUpdate);
    })
    .on('remove', function () {
      window.removeHook('mapDataRefreshEnd', apTargets.scheduleUpdate);
      window.removeHook('linkAdded', apTargets.scheduleUpdate);
      window.removeHook('linkRemoved', apTargets.scheduleUpdate);
      window.removeHook('fieldAdded', apTargets.scheduleUpdate);
      window.removeHook('fieldRemoved', apTargets.scheduleUpdate);
      map.off('moveend', apTargets.scheduleUpdate);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    });

  // Layer chooser entry: toggles the on-map badges. Name must be stable across
  // releases — layerChooser persists enable state keyed by name.
  window.layerChooser.addOverlay(apTargets.layer, 'AP Targets', { default: false });

  // Toolbox entry: opens the on-demand panel regardless of layer state.
  $('#toolbox').append(
    $('<a>')
      .text('AP Targets')
      .attr('title', 'Show top enemy portals ranked by destruction AP')
      .on('click', function (e) { e.preventDefault(); apTargets.openPanel(); })
  );

  $('<style>')
    .html(
      '.ap-targets-badge-wrap{background:transparent;border:none;}' +
      '.ap-targets-badge{width:32px;text-align:center;pointer-events:none;}' +
      '.ap-targets-rank{display:inline-block;width:22px;height:22px;border-radius:11px;' +
      'background:#c00;color:#fff;font:bold 12px/22px sans-serif;' +
      'border:1px solid #fff;box-shadow:0 0 0 1px #000;}' +
      '.ap-targets-ap{margin-top:2px;font:bold 10px/12px sans-serif;color:#fff;' +
      'text-shadow:-1px -1px #000,1px -1px #000,-1px 1px #000,1px 1px #000;}' +
      '.ap-targets-panel .apt-meta{font-size:11px;color:#888;margin-bottom:6px;}' +
      '.ap-targets-panel .apt-table{border-collapse:collapse;width:100%;}' +
      '.ap-targets-panel .apt-table th,.ap-targets-panel .apt-table td{padding:2px 8px;text-align:left;border-bottom:1px solid #333;}' +
      '.ap-targets-panel .apt-table th{font-weight:bold;}' +
      '.ap-targets-panel .apt-table td:nth-child(1),.ap-targets-panel .apt-table th:nth-child(1){text-align:right;width:2em;}' +
      '.ap-targets-panel .apt-table td:nth-child(2),.ap-targets-panel .apt-table th:nth-child(2),' +
      '.ap-targets-panel .apt-table td:nth-child(3),.ap-targets-panel .apt-table th:nth-child(3),' +
      '.ap-targets-panel .apt-table td:nth-child(4),.ap-targets-panel .apt-table th:nth-child(4){text-align:right;}'
    )
    .appendTo('head');
}

setup.info = plugin_info;
if(!window.bootPlugins) window.bootPlugins = [];
window.bootPlugins.push(setup);
if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
