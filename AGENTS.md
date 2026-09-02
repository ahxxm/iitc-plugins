# AGENTS.md — IITC plugin repo

Working files: `tidy-links-reality.user.js`, `ap-targets.user.js`, tests in `test/`.
Run tests: `node --test 'test/*.test.js'`.

## The IITC plugin contract

Every `.user.js` here is a Tampermonkey/Violentmonkey userscript for the Ingress Intel Total Conversion (IITC) map at `https://intel.ingress.com/*`. IITC plugins must execute **inside the page context**. The whole file follows the standard plugin skeleton (docs: IITC "Plugin API" / "Core"; reference implementation: IITC-CE `pluginwrapper.py`).

### 1. Metadata header (`==UserScript==`)

| Field | Requirement |
|---|---|
| `@id` | Unique plugin id, lowercase-dash (e.g. `ap-targets`). Must match `plugin_info.pluginId` set inside the wrapper. |
| `@name` | Convention: `IITC plugin: <Human Name>` |
| `@category` | One of the IITC plugin categories (`Draw`, `Info`, `Layers`, `Map Tiles`, `Misc`, `Portal Info`, `Trash`, `UI`, `Tweaks`, …) — controls where the plugin appears in "About IITC" listings. |
| `@version` | Semver-ish; bump on every user-visible change (see changelog convention below). |
| `@description` | Shown on the About page. |
| `@namespace` | Any stable URI; we use the IITC-CE GitHub URL. |
| `@match` | `https://intel.ingress.com/*` and `https://intel-x.ingress.com/*` |
| `@grant` | `none` — mandatory: page-context injection breaks under sandboxed grants. |

### 2. Wrapper + injection boilerplate (never vary it)

```
function wrapper(plugin_info) {
  if(typeof window.plugin !== 'function') window.plugin = function() {};
  plugin_info.buildName = 'local';        // third-party marker
  plugin_info.dateTimeVersion = 'YYYY-MM-DD';
  plugin_info.pluginId = '<same as @id>';
  // ... all plugin code, incl. function setup() ...
  setup.info = plugin_info;               // IITC reads this for the About page
  if(!window.bootPlugins) window.bootPlugins = [];
  window.bootPlugins.push(setup);
  if(window.iitcLoaded && typeof setup === 'function') setup();
}
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: ..., name: ..., description: ... };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
```

Why it looks like this:

* The wrapper is `Function.toString()`-ed and injected as an IIFE, so everything must be reachable via `window.*` or defined inside the wrapper.
* `plugin_info` arrives from `GM_info`; `setup.info = plugin_info` is required, IITC renders it on the About page.
* `window.bootPlugins` runs after IITC boots; the `window.iitcLoaded` check covers the case where the userscript ran after boot (userscript-vs-page load order is not guaranteed).

### 3. Namespacing

Each plugin owns exactly one property: `window.plugin.<camelCaseName>`. e.g. `window.plugin.apTargets`, `window.plugin.tidyLinksReality`. The `if(typeof window.plugin !== 'function')` line at the top of the wrapper guards against running before IITC (or another plugin) created the namespace root.

### 4. `setup()` rules

* Called once, after IITC core + all other boot plugins exist. Core globals (`window.map`, `window.portals`, `L`, `$`, hook system) are guaranteed by then.
* One-time init: create layers, register UI entry points, install styles; never do per-render work here.
* `setup.info = plugin_info` must be set on the same function pushed into `bootPlugins`.

### 5. Runtime APIs these plugins rely on

**Hooks** (`window.addHook(event, fn)` / `window.removeHook(event, fn)`; `removeHook` requires the *same function reference*, so keep handlers in variables):

* Data lifecycle: `mapDataRefreshStart`, `mapDataEntityInject`, `mapDataRefreshEnd`, `portalAdded/Removed`, `linkAdded/Removed`, `fieldAdded/Removed` (link/field hooks fire when the entity is *about to be* rendered).
* `portalDetailsLoaded` (guid, success, details), `portalDetailsUpdated`, `portalSelected`, `iitcLoaded`, `paneChanged`, `baseLayerChanged`, `requestFinished` (deprecated → use `mapDataRefreshEnd`).
* Plugin-defined custom hooks are legal via `window.runHooks(name, data)`.

**Map data model** — plain objects keyed by entity GUID, values are Leaflet layers; the payload lives in `layer.options.data`:

* `window.portals[guid]` — CircleMarker; `data`: `title`, `team` ('R'/'E'/'M'/'N'), `level`, `health`, `resCount`, `image`, `guid`. Position via `portal.getLatLng()`.
* `window.links[guid]` — Polyline; `data`: `oGuid`, `dGuid` (plus o/d lat/lng).
* `window.fields[guid]` — Polygon; `data`: `points` = the 3 vertex records, each `{ guid, latE6, lngE6, type: 'portal' }`.
* **Caveats:** these hold only what is currently *rendered*, and render limits drop entities in dense viewports. Portal markers exist only at zoom ≥ 15 (below that the map data response contains links/fields only, so per-portal logic must degrade gracefully). Per-portal detail (mods, resonators) is absent from the map-data payload; get it via `window.portalDetailLoaded`.

**UI:**

* `window.layerChooser.addOverlay(layerGroup, 'Stable Name', { default: false })` — adds the map layer checkbox. The name string is the persistence key for the user's enabled/disabled state: **never rename a layer in a released plugin**, users' settings would reset.
* `window.dialog({ title, id, html, width, closeCallback })` — jQuery-UI dialog. Give it a stable `id`; the DOM element gets that id, so refresh the open dialog via `document.getElementById(id).innerHTML = ...` and track open-state in a flag reset by `closeCallback`.
* Toolbox links: `$('#toolbox').append($('<a>').text(...).on('click', ...))`.
* Styles: inject once from `setup()` via `$('<style>').html(css).appendTo('head')`; prefix every class with the plugin id (`.ap-targets-…`).
* `L` is the global Leaflet; `window.PLAYER` has `{ nickname, team: 'RESISTANCE'|'ENLIGHTENED', ... }` and is static until reload. `window.selectedPortal` is the selected guid or `null`.

### 6. Repo conventions

* ES5 only inside the wrapper (`var`, no arrow functions, no template literals). eslint directives at top: `/* exported setup --eslint */`, `/* global L -- eslint */`.
* Pure logic (geometry, ranking, routing) is exposed on the plugin namespace and additionally exported as `plugin.<ns>._fns = { ... }` so the test harness can call functions directly.
* `tidy-links-reality.user.js` keeps a `changelog` array (version → changes list); update it when bumping `@version`.
* Tests (`test/invariants.test.js`) load the *real* `.user.js` in a `vm` context via `test/lib/harness.js`, which mocks Leaflet, map, window, hooks, and jQuery. The mock map projects identity: pixel space == lat/lng space, distances are exact Euclidean. If a plugin needs a new core API, extend the harness mock rather than stubbing ad hoc in a test. Each test asserts an invariant that maps to a real regression we hit — name them (`I1 planarity: …`) and keep that style.
