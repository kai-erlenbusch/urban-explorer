<script>
  import { onMount, onDestroy } from 'svelte';
  import { activeLayer, analysisData, demographicsData, transitData, radius } from './stores.js';
  import maplibregl from 'maplibre-gl';
  import * as turf from '@turf/turf';
  import 'maplibre-gl/dist/maplibre-gl.css';

  let map;
  let mapContainer;
  let currentRadius;
  let cursorPosition = null;
  let currentMode = 'landuse';

  // --- CONFIGURATION ---
  const MAPBOX_TOKEN = 'pk.eyJ1Ijoia2FpLWVybGVuYnVzY2giLCJhIjoiY21qZzM5Z3FnMHk3MTNkcHNrcDJ0ajFpNyJ9.X4SxJOFBNAxGo8G5qHLKXA';
  
  const LANDUSE_TILESET_ID = 'mapbox://kai-erlenbusch.9a769cf2';
  const LANDUSE_SOURCE_LAYER = 'mn_mappluto-d8n2zk';
  const CENSUS_TILESET_ID = 'mapbox://kai-erlenbusch.0ua9vbjj';
  const CENSUS_SOURCE_LAYER = 'census_dots_full';
  const TRANSIT_TILESET_ID = 'mapbox://kai-erlenbusch.ydqfgcin'; 

  // World Mask
  const WORLD_MASK = turf.polygon([[
    [-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]
  ]]);

  // --- STORES ---
  const unsubscribeRadius = radius.subscribe(value => {
    currentRadius = value;
    if (map && cursorPosition) updateMapState(cursorPosition);
  });

  const unsubscribeLayer = activeLayer.subscribe(value => {
    currentMode = value;
    if (!map || !map.isStyleLoaded()) return;
    
    const isLandUse = value === 'landuse';
    const isDemo = value === 'demographics';
    const isTransit = value === 'transit';

    if (map.getLayer('pluto-fill')) map.setLayoutProperty('pluto-fill', 'visibility', isLandUse ? 'visible' : 'none');
    if (map.getLayer('census-dots')) map.setLayoutProperty('census-dots', 'visibility', isDemo ? 'visible' : 'none');

    const transitIds = [
        'transit-bus-lines', 'transit-bus-stops', 'transit-subway-lines', 'transit-subway-stations',
        'transit-rail-lines-rail_lirr_routes', 'transit-rail-lines-rail_mnr_routes', 
        'transit-rail-lines-rail_njt_routes', 'transit-rail-lines-rail_amtrak_routes', 'transit-rail-lines-rail_path_routes',
        'transit-rail-stations-rail_lirr_stops', 'transit-rail-stations-rail_mnr_stops', 
        'transit-rail-stations-rail_njt_stops', 'transit-rail-stations-rail_amtrak_stops', 'transit-rail-stations-rail_path_stops'
    ];
    transitIds.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', isTransit ? 'visible' : 'none');
    });

    setTimeout(() => {
        if (cursorPosition) updateMapState(cursorPosition);
    }, 100);
  });

  // --- ENGINE ---
  function updateMapState(lngLat) {
    if (!map) return;
    cursorPosition = lngLat;

    const centerPoint = turf.point([lngLat.lng, lngLat.lat]);
    const circleGeo = turf.circle(centerPoint, currentRadius, { steps: 64, units: 'miles' });

    // Update Mask
    if (map.getSource('mask-source')) {
        const maskGeometry = turf.difference(turf.featureCollection([WORLD_MASK, circleGeo]));
        map.getSource('mask-source').setData(maskGeometry);
    }

    // Update Lens Outline
    if (map.getSource('lens-source')) {
        map.getSource('lens-source').setData(circleGeo);
    }

    if (currentMode === 'landuse') analyzeLandUse(circleGeo);
    else if (currentMode === 'demographics') analyzeDemographics(centerPoint);
    else if (currentMode === 'transit') analyzeTransit(centerPoint);
  }

  // ... (Analyze functions skipped for brevity, they remain identical to previous working version) ...
  function analyzeLandUse(circleGeo) {
    const bbox = turf.bbox(circleGeo);
    const southWest = map.project([bbox[0], bbox[1]]);
    const northEast = map.project([bbox[2], bbox[3]]);
    const features = map.queryRenderedFeatures([southWest, northEast], { layers: ['pluto-fill'] });
    let totalArea = 0; let counts = {}; const seenIds = new Set();
    features.forEach(f => {
        const uniqueId = f.id || f.properties.BBL || f.properties.LotArea;
        if (seenIds.has(uniqueId)) return;
        if (turf.booleanIntersects(f, circleGeo)) {
            seenIds.add(uniqueId);
            const rawLU = f.properties.LandUse; 
            const area = (f.properties.LotArea || turf.area(f)) * 0.000247105; 
            if (rawLU) {
                const cleanKey = parseInt(String(rawLU), 10).toString();
                if (cleanKey && cleanKey !== "NaN") {
                    if (!counts[cleanKey]) counts[cleanKey] = 0; counts[cleanKey] += area; totalArea += area;
                }
            }
        }
    });
    let entropy = 0;
    if (totalArea > 0) {
        let H = 0;
        Object.values(counts).forEach(a => { const p = a / totalArea; if (p > 0) H -= p * Math.log(p); });
        entropy = H / Math.log(11); 
    }
    analysisData.set({ count: seenIds.size, area: totalArea, breakdown: counts, entropy });
  }

  function analyzeDemographics(centerPoint) {
    const features = map.queryRenderedFeatures({ layers: ['census-dots'] });
    let totalPeople = 0; let ethnicityCounts = {}; let femaleCount = 0; 
    let ageCounts = { '0-4': 0, '5-17': 0, '18-34': 0, '35-59': 0, '60+': 0 };
    const radiusKm = currentRadius * 1.60934;
    features.forEach(f => {
        const pt = turf.point(f.geometry.coordinates);
        if (turf.distance(centerPoint, pt, {units: 'kilometers'}) <= radiusKm) {
            const eth = f.properties.ethnicity || 'Other';
            const pop = f.properties.pop_est || 1; 
            totalPeople += pop;
            if (!ethnicityCounts[eth]) ethnicityCounts[eth] = 0; ethnicityCounts[eth] += pop;
            if (f.properties.sex === 'Female') femaleCount += pop;
            const age = f.properties.age_group;
            if (age && ageCounts[age] !== undefined) ageCounts[age] += pop;
        }
    });
    let sumSquares = 0;
    if (totalPeople > 0) { Object.values(ethnicityCounts).forEach(count => { const p = count / totalPeople; sumSquares += p * p; }); }
    demographicsData.set({ totalPeople, density: totalPeople / (Math.PI * currentRadius * currentRadius * 640), ethnicityBreakdown: ethnicityCounts, diversityIndex: totalPeople > 0 ? (1 - sumSquares) : 0, percentFemale: totalPeople > 0 ? (femaleCount / totalPeople) * 100 : 0, ageBreakdown: ageCounts });
  }

  function analyzeTransit(centerPoint) {
    const radiusKm = currentRadius * 1.60934;
    const circleGeo = turf.circle(centerPoint, currentRadius, { steps: 16, units: 'miles' });
    const bbox = turf.bbox(circleGeo);
    const p1 = map.project([bbox[0], bbox[1]]);
    const p2 = map.project([bbox[2], bbox[3]]);
    const bboxPixels = [p1, p2];

    const subStations = map.queryRenderedFeatures({ layers: ['transit-subway-stations'] });
    const foundSubLines = new Set();
    let subCount = 0;
    subStations.forEach(f => {
        const pt = turf.point(f.geometry.coordinates);
        if (turf.distance(centerPoint, pt, {units: 'kilometers'}) <= radiusKm) {
            subCount++;
            const linesStr = f.properties.trains || f.properties.lines || f.properties.name || "";
            const parts = linesStr.split(/[\s-]+/); 
            parts.forEach(p => { if (/^[A-Z0-9]+$/.test(p) && p.length <= 2) foundSubLines.add(p); });
        }
    });
    const subTracks = map.queryRenderedFeatures(bboxPixels, { layers: ['transit-subway-lines'] });
    subTracks.forEach(f => { const line = f.properties.route_id || f.properties.route_shor || f.properties.name; if (line) foundSubLines.add(line); });

    const railStations = map.queryRenderedFeatures({ layers: ['transit-rail-stations-rail_lirr_stops', 'transit-rail-stations-rail_mnr_stops', 'transit-rail-stations-rail_njt_stops', 'transit-rail-stations-rail_amtrak_stops', 'transit-rail-stations-rail_path_stops'] });
    const foundRailLines = new Set();
    let railCount = 0;
    railStations.forEach(f => {
        const pt = turf.point(f.geometry.coordinates);
        if (turf.distance(centerPoint, pt, {units: 'kilometers'}) <= radiusKm) {
            railCount++;
            const id = f.layer.id;
            if (id.includes("lirr")) foundRailLines.add("LIRR"); else if (id.includes("mnr")) foundRailLines.add("Metro-North"); else if (id.includes("njt")) foundRailLines.add("NJ Transit"); else if (id.includes("amtrak")) foundRailLines.add("Amtrak"); else if (id.includes("path")) foundRailLines.add("PATH");
        }
    });
    const railTracks = map.queryRenderedFeatures(bboxPixels, { layers: ['transit-rail-lines-rail_lirr_routes', 'transit-rail-lines-rail_mnr_routes', 'transit-rail-lines-rail_njt_routes', 'transit-rail-lines-rail_amtrak_routes', 'transit-rail-lines-rail_path_routes'] });
    railTracks.forEach(f => {
        const id = f.layer.id;
        if (id.includes("lirr")) foundRailLines.add("LIRR"); else if (id.includes("mnr")) foundRailLines.add("Metro-North"); else if (id.includes("njt")) foundRailLines.add("NJ Transit"); else if (id.includes("amtrak")) foundRailLines.add("Amtrak"); else if (id.includes("path")) foundRailLines.add("PATH");
    });

    const busStops = map.queryRenderedFeatures({ layers: ['transit-bus-stops'] });
    let busStopCount = 0;
    busStops.forEach(f => { const pt = turf.point(f.geometry.coordinates); if (turf.distance(centerPoint, pt, {units: 'kilometers'}) <= radiusKm) busStopCount++; });
    const busLinesFeatures = map.queryRenderedFeatures(bboxPixels, { layers: ['transit-bus-lines'] });
    const foundBusLines = new Set();
    busLinesFeatures.forEach(f => {
        const props = f.properties;
        const name = props.route_id || props.route_short_name || props.route_short || props.ref || props.name;
        if (name) { const cleanName = name.split(' ')[0]; if (cleanName.length > 0 && cleanName.length < 6) foundBusLines.add(cleanName); else foundBusLines.add(name); }
    });

    transitData.set({ subwayStationCount: subCount, subwayLines: Array.from(foundSubLines).sort(), railStationCount: railCount, railLines: Array.from(foundRailLines).sort(), busStopCount: busStopCount, busLines: Array.from(foundBusLines).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})) });
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-73.985, 40.748], 
      zoom: 13,
      minZoom: 9, 
      transformRequest: (url) => {
        if (url.startsWith("mapbox://")) {
          return {
            url: url.replace("mapbox://", "https://api.mapbox.com/v4/") + `.json?access_token=${MAPBOX_TOKEN}`,
            headers: { "Content-Type": "application/json" }
          };
        }
        return { url };
      }
    });

    map.on('load', () => {
      const layers = map.getStyle().layers;

      // 1. HIDE BUILDINGS
      layers.forEach(layer => {
          if (layer.id.includes('building')) {
              map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
      });

      // 2. FIND "WATER" OR "ROAD" LAYER (Insertion Point)
      // This is the fix. We want to insert our stuff BELOW water/roads.
      let insertionLayerId;
      for (const layer of layers) {
        // We look for water first, as it's usually at the bottom of the "features" stack
        if (layer.id.includes('water') && layer.type === 'fill') {
          insertionLayerId = layer.id;
          break; 
        }
      }
      // If no water layer found easily, fallback to roads or first label
      if (!insertionLayerId) {
         for (const layer of layers) {
            if (layer.id.includes('road') || layer.type === 'symbol') {
                insertionLayerId = layer.id;
                break;
            }
         }
      }

      console.log("Inserting Data/Mask BELOW layer:", insertionLayerId);

      // --- ADD DATA LAYERS (Insert at Bottom) ---
      
      // Land Use
      map.addSource('pluto-data', { type: 'vector', url: LANDUSE_TILESET_ID });
      map.addLayer({
        'id': 'pluto-fill', 'type': 'fill', 'source': 'pluto-data', 'source-layer': LANDUSE_SOURCE_LAYER, 'minzoom': 10,
        'paint': { 
            'fill-color': [
                'match', ['to-string', ['get', 'LandUse']], 
                '01', '#F9EDDB', '1', '#F9EDDB', '02', '#F6D9CB', '2', '#F6D9CB', '03', '#F6D9CB', '3', '#F6D9CB',
                '04', '#F1B89C', '4', '#F1B89C', '05', '#DF7649', '5', '#DF7649', '06', '#CF4F4F', '6', '#CF4F4F',
                '07', '#BEC6CC', '7', '#BEC6CC', '08', '#BDE7F4', '8', '#BDE7F4', '09', '#A3D393', '9', '#A3D393',
                '10', '#8DA2B4', '11', '#E4E4E4', '#cccccc'
            ],
            'fill-opacity': 1 
        },
        'layout': { 'visibility': 'visible' }
      }, insertionLayerId);
      
      // Demographics
      map.addSource('census-source', { type: 'vector', url: CENSUS_TILESET_ID });
      map.addLayer({
        id: 'census-dots', type: 'circle', source: 'census-source', 'source-layer': CENSUS_SOURCE_LAYER, minzoom: 8, 
        paint: {
          'circle-radius': { 'base': 1.5, 'stops': [[8, 1], [16, 4]] },
          'circle-color': [ 'match', ['get', 'ethnicity'], 'Asian', '#eeae9f', 'Black', '#68c582', 'Hispanic', '#f0ba5e', 'White', '#4674ea', '#b1b1b1' ],
          'circle-opacity': 0.8
        },
        'layout': { 'visibility': 'none' }
      }, insertionLayerId);

      // Transit Layers
      map.addSource('transit-source', { type: 'vector', url: TRANSIT_TILESET_ID });
      const transitLayers = [
          {id: 'transit-bus-lines', type: 'line', src: 'bus_routes', paint: {'line-color': '#0245ef', 'line-width': 1, 'line-opacity': 0.8}},
          {id: 'transit-bus-stops', type: 'circle', src: 'bus_stops', paint: {'circle-color': '#0245ef', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.5]}},
          {id: 'transit-subway-lines', type: 'line', src: 'subway_lines', paint: {'line-width': 2.5, 'line-color': '#ffd73e'}},
          {id: 'transit-subway-stations', type: 'circle', src: 'subway_stations', paint: {'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffd73e'}},
      ];
      transitLayers.forEach(l => {
          map.addLayer({
              id: l.id, type: l.type, source: 'transit-source', 'source-layer': l.src, paint: l.paint, layout: { 'visibility': 'none' }
          }, insertionLayerId);
      });

      ['rail_lirr', 'rail_mnr', 'rail_njt', 'rail_amtrak', 'rail_path'].forEach(agency => {
          map.addLayer({
            id: `transit-rail-lines-${agency}_routes`, type: 'line', source: 'transit-source', 'source-layer': `${agency}_routes`,
            paint: { 'line-color': '#ff98ab', 'line-width': 1.5 }, layout: { 'visibility': 'none' }
          }, insertionLayerId);
          map.addLayer({
            id: `transit-rail-stations-${agency}_stops`, type: 'circle', source: 'transit-source', 'source-layer': `${agency}_stops`,
            paint: { 'circle-radius': 3, 'circle-color': '#ff98ab', 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' }, layout: { 'visibility': 'none' }
          }, insertionLayerId);
      });

      // --- BUILDING OUTLINES (Inside Circle) ---
      // We insert these with the data (below mask)
      map.addLayer({
          'id': 'building-outlines',
          'type': 'line',
          'source': 'composite',
          'source-layer': 'building', 
          'minzoom': 14,
          'paint': {
              'line-color': '#999999',
              'line-width': 1,
              'line-opacity': 0.4
          }
      }, insertionLayerId);

      // --- MASK LAYER (Solid Gray) ---
      // Inserted BEFORE 'water', so water/roads draw ON TOP of it.
      // But inserted AFTER data (because we added data first to the stack).
      map.addSource('mask-source', { type: 'geojson', data: WORLD_MASK });
      map.addLayer({
        id: 'mask-layer', type: 'fill', source: 'mask-source',
        paint: { 
            'fill-color': '#e5e5e5', // Map Gray 
            'fill-opacity': 1.0     // Solid Mask covers Data
        }
      }, insertionLayerId);

      // --- LENS OUTLINE (Always Top) ---
      map.addSource('lens-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'lens-outline', type: 'line', source: 'lens-source',
        paint: {
            'line-color': '#333333',
            'line-width': 1.5,
            'line-dasharray': [2, 3] 
        }
      }); // No 'beforeId', so it goes to the very top

      map.on('mousemove', (e) => updateMapState(e.lngLat));
      updateMapState(map.getCenter());
    });
  });

  onDestroy(() => {
    unsubscribeRadius();
    unsubscribeLayer();
    if (map) map.remove();
  });
</script>

<div class="map-wrap" bind:this={mapContainer}></div>

<style>
  .map-wrap { width: 100%; height: 100%; position: relative; }
</style>