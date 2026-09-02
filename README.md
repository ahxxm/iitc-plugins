# Ingress IITC Plugins

`tidy-links-reality.user.js`: existing plugin draws dotted lines for tidy links *despite of* existing links, this one draws *in addition to* them, and answers the question "in this area what remaining links to be created?". Delaunay triangulation minus edges that cross an existing link, so it stays tidy and planar; a repair pass keeps border portals from being stranded. All portals count regardless of team (you deploy/destroy to own any of them).

One layer shows both the links and an efficient walk to make them: portals within one action range (40m) collapse to a single stop, and disconnected clusters (walled off by existing links) route separately, one color each. Links throwable on the forward pass vs ones whose key you collect later (amber, flagged "return") are shown per stop. When a viewport grid cell holds several clusters it collapses to one "N routes · M links" count badge (real-estate style) that expands into detail as you zoom in. Per-cluster Google Maps link + full stop list in the toolbox "Route Plan" dialog.

`ap-targets.user.js`: top-10 enemy portals in viewport by destruction AP (187 per link + 750 per field touching). Numbered badges on map; full list in a dialog from the IITC toolbox.

[gcj02-fix.user.js](https://github.com/ahxxm/iitc-plugins/raw/master/gcj02-fix.user.js): automatically applies in mainland China such that you see real portal locations on the up-to-date map, enable when using Gaode, disable when OSM otherwise double offset


## Known limitations

* portal Softbank(outgoing) status is unknown until tap, but you don't often see 2 portals with such mods and their outgoing links all fully occupied
* AP rank skips resonators (75 each) since that data needs a per-portal tap, besides this, the estimated AP gain is always under long-tap value
* route is a straight-line heuristic, not optimal and not road/foot-network; some links can't be thrown until a later stop hands you the key (flagged "return"), and hacks for keys are assumed to drop
* portals load only at zoom ≥ 15; over ~500 portals in view (1500 inside a drawn polygon) the plan is skipped with a "zoom in or draw a smaller polygon" note (drawing thousands of links would freeze the map)

## Tests

`node --test 'test/*.test.js'` — loads each plugin in a vm with a mock Leaflet/map and asserts invariants (no planned links cross, existing links respected, degenerate input doesn't zero the plan, no portal stranded, capacity not exceeded, route forward/return correct). `test/lib/harness.js` is the loader/mock.
