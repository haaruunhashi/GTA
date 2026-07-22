# Regenerating the city from OpenStreetMap

`assets/citydata.js` is baked offline from OpenStreetMap (Lower Manhattan).
Map data © OpenStreetMap contributors, ODbL.

1. Fetch raw OSM (buildings + roads) for the district via Overpass:

   ```sh
   Q='[out:json][timeout:90];(way[building](40.7025,-74.0170,40.7220,-73.9980);way[highway](40.7025,-74.0170,40.7220,-73.9980););out geom;'
   curl -sS "https://overpass-api.de/api/interpreter" --data-urlencode "data=$Q" -o osm-raw.json
   ```

2. Convert to the game's building AABBs + drivable road graph:

   ```sh
   node build/convert-osm.mjs   # reads ./osm-raw.json, writes assets/citydata.js
   ```

The converter projects lat/lon into the game's CITY bounds, extrudes building
heights from OSM `height` / `building:levels`, keeps tunnel corridors clear, and
builds a node/edge road graph that the traffic AI follows. If `assets/citydata.js`
is missing, `core.js` falls back to the original procedural grid.
