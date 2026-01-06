<script>

  console.log(">>> NEW MAP COMPONENT LOADED <<<");
  
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
  
  // Performance Throttling
  let animationFrameId;
  let isUpdating = false;

  // --- RAW DATA STORAGE (For Accurate Analysis) ---
  let rawCensusData = null;
  let rawTransitData = {
      subwayStations: null,
      subwayLines: null,
      busStops: null,
      busLines: null,
      rail: {
          lirr: { stops: null, routes: null },
          mnr: { stops: null, routes: null },
          njt: { stops: null, routes: null },
          amtrak: { stops: null, routes: null },
          path: { stops: null, routes: null }
      }
  };

  // --- CONFIGURATION ---
  // Ideally move this token to an .env file (e.g. import.meta.env.VITE_MAPBOX_TOKEN)
  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

  // Safety check: Warn if token is missing
  if (!MAPBOX_TOKEN) {
      console.error("Mapbox Token is missing! Make sure you created a .env file with VITE_MAPBOX_TOKEN.");
  }
  
  const LANDUSE_TILESET_ID = 'mapbox://kai-erlenbusch.9a769cf2';
  const LANDUSE_SOURCE_LAYER = 'mn_mappluto-d8n2zk';
  const CENSUS_TILESET_ID = 'mapbox://kai-erlenbusch.0ua9vbjj';
  const CENSUS_SOURCE_LAYER = 'census_dots_full';
  const TRANSIT_TILESET_ID = 'mapbox://kai-erlenbusch.ydqfgcin';

  let MANHATTAN_MASK = null;
  const WORLD_MASK = turf.polygon([[
    [-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]
  ]]);

  // --- STORES ---
  const unsubscribeRadius = radius.subscribe(value => {
    currentRadius = value;
    if (map && cursorPosition) triggerUpdate(cursorPosition);
  });

  const unsubscribeLayer = activeLayer.subscribe(value => {
    currentMode = value;
    if (!map || !map.isStyleLoaded()) return;
    
    const isLandUse = value === 'landuse';
    const isDemo = value === 'demographics';
    const isTransit = value === 'transit';

    // 1. Toggle Data Layers
    if (map.getLayer('pluto-fill')) map.setLayoutProperty('pluto-fill', 'visibility', isLandUse ? 'visible' : 'none');
    if (map.getLayer('pluto-lines')) map.setLayoutProperty('pluto-lines', 'visibility', isLandUse ? 'visible' : 'none');
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

    // 2. TOGGLE MASKS & WATER
    if (map.getLayer('mask-layer-top')) map.setLayoutProperty('mask-layer-top', 'visibility', isTransit ? 'visible' : 'none');
    if (map.getLayer('mask-layer-bottom')) map.setLayoutProperty('mask-layer-bottom', 'visibility', isTransit ? 'none' : 'visible');
    if (map.getLayer('water-rescue')) map.setLayoutProperty('water-rescue', 'visibility', isTransit ? 'visible' : 'none');

    // Trigger update to refresh analysis for new mode
    if (cursorPosition) triggerUpdate(cursorPosition);
  });

  // --- ENGINE ---
  function triggerUpdate(lngLat) {
      cursorPosition = lngLat;
      if (!isUpdating) {
          isUpdating = true;
          animationFrameId = requestAnimationFrame(() => {
              updateMapState(lngLat);
              isUpdating = false;
          });
      }
  }

  function updateMapState(lngLat) {
    if (!map) return;

    const centerPoint = turf.point([lngLat.lng, lngLat.lat]);
    const circleGeo = turf.circle(centerPoint, currentRadius, { steps: 64, units: 'miles' });

    // UPDATE VISUALS (Mask & Lens)
    if (map.getSource('mask-source')) {
        let maskBase = MANHATTAN_MASK || WORLD_MASK;
        let maskGeometry;
        try {
            maskGeometry = turf.difference(turf.featureCollection([maskBase, circleGeo]));
        } catch(e) {
            maskGeometry = maskBase;
        }
        if (maskGeometry) map.getSource('mask-source').setData(maskGeometry);
    }

    if (map.getSource('lens-source')) {
        map.getSource('lens-source').setData(circleGeo);
    }

    // RUN ANALYSIS
    if (currentMode === 'landuse') analyzeLandUse(circleGeo);
    else if (currentMode === 'demographics') analyzeDemographics(centerPoint);
    else if (currentMode === 'transit') analyzeTransit(centerPoint);
  }

  // --- NEW RAW DATA ANALYSIS FUNCTIONS ---

  function analyzeDemographics(centerPoint) {
    if (!rawCensusData) return;

    const circleGeo = turf.circle(centerPoint, currentRadius, { steps: 64, units: 'miles' });
    const bbox = turf.bbox(circleGeo); 
    const radiusKm = currentRadius * 1.60934;

    let totalPeople = 0;
    let ethnicityCounts = {}; 
    let femaleCount = 0; 
    let ageCounts = { '0-4': 0, '5-17': 0, '18-34': 0, '35-59': 0, '60+': 0 };

    // DETECT KEYS DYNAMICALLY (Case-Insensitive)
    // We check the first feature to find the actual property names in your raw file
    const sampleProps = rawCensusData.features[0]?.properties || {};
    const keys = Object.keys(sampleProps);
    const keyEth = keys.find(k => k.toLowerCase() === 'ethnicity') || 'ethnicity';
    const keyAge = keys.find(k => k.toLowerCase() === 'age_group') || 'age_group';
    const keySex = keys.find(k => k.toLowerCase() === 'sex') || 'sex';
    const keyPop = keys.find(k => k.toLowerCase() === 'pop_est') || 'pop_est';

    for (const f of rawCensusData.features) {
        const coords = f.geometry.coordinates;

        // 1. Fast BBox Exclusion
        if (coords[0] < bbox[0] || coords[0] > bbox[2] || coords[1] < bbox[1] || coords[1] > bbox[3]) continue;

        // 2. Precise Distance Check
        const pt = turf.point(coords);
        if (turf.distance(centerPoint, pt, { units: 'kilometers' }) <= radiusKm) {
             const props = f.properties;
             
             // Use the dynamic keys we found above
             const pop = props[keyPop] || 1; 
             const eth = props[keyEth] || 'Other';
 
             totalPeople += pop;
 
             // Ethnicity
             if (!ethnicityCounts[eth]) ethnicityCounts[eth] = 0; 
             ethnicityCounts[eth] += pop;
 
             // Gender
             if (props[keySex] === 'Female') femaleCount += pop;
 
             // Age
             const age = props[keyAge];
             if (age && ageCounts[age] !== undefined) ageCounts[age] += pop;
        }
    }

    // DEBUG: Uncomment this if charts are still empty to see what keys are being found
    console.log("Detected Keys:", { keyEth, keyAge, keySex, keyPop });
    console.log("Sample Counts:", { ethnicityCounts, ageCounts });

    let sumSquares = 0;
    if (totalPeople > 0) { 
        Object.values(ethnicityCounts).forEach(count => { 
            const p = count / totalPeople; 
            sumSquares += p * p; 
        });
    }

    demographicsData.set({ 
        totalPeople, 
        density: totalPeople / (Math.PI * currentRadius * currentRadius * 640), 
        ethnicityBreakdown: ethnicityCounts, 
        diversityIndex: totalPeople > 0 ? (1 - sumSquares) : 0, 
        percentFemale: totalPeople > 0 ? (femaleCount / totalPeople) * 100 : 0, 
        ageBreakdown: ageCounts 
    });
  }

  function analyzeTransit(centerPoint) {
      if (!rawTransitData.subwayStations) return;

      const circleGeo = turf.circle(centerPoint, currentRadius, { steps: 32, units: 'miles' });
      const bbox = turf.bbox(circleGeo);

      // Helper: Check points
      const countPoints = (featureCollection) => {
          if (!featureCollection) return 0;
          // Using turf.pointsWithinPolygon is cleaner for collections
          const pts = turf.pointsWithinPolygon(featureCollection, circleGeo);
          return pts.features.length;
      };

      // Helper: Check lines (using BBox first for speed)
      const getIntersectingLines = (featureCollection, nameField) => {
          const found = new Set();
          if (!featureCollection) return found;

          for (const f of featureCollection.features) {
              // BBox overlap check (simple approximation)
              const fBbox = turf.bbox(f);
              const overlap = !(bbox[0] > fBbox[2] || bbox[2] < fBbox[0] || bbox[1] > fBbox[3] || bbox[3] < fBbox[1]);
              
              if (overlap) {
                  // Precise check
                  if (turf.booleanIntersects(f, circleGeo)) {
                      const name = f.properties[nameField] || f.properties.route_id || f.properties.name;
                      if (name) found.add(name);
                  }
              }
          }
          return found;
      };

      // 1. Subway
      const subStationsInside = turf.pointsWithinPolygon(rawTransitData.subwayStations, circleGeo);
      const subCount = subStationsInside.features.length;
      const foundSubLines = new Set();
      
      // Get lines from stations
      subStationsInside.features.forEach(f => {
          const linesStr = f.properties.trains || f.properties.lines || f.properties.name || "";
          const parts = linesStr.split(/[\s-]+/); 
          parts.forEach(p => { if (/^[A-Z0-9]+$/.test(p) && p.length <= 2) foundSubLines.add(p); });
      });
      // Get lines from tracks
      const trackLines = getIntersectingLines(rawTransitData.subwayLines, 'route_id');
      trackLines.forEach(l => foundSubLines.add(l));

      // 2. Rail
      let railCount = 0;
      const foundRailLines = new Set();
      
      const railAgencies = [
          { key: 'lirr', name: 'LIRR' }, { key: 'mnr', name: 'Metro-North' },
          { key: 'njt', name: 'NJ Transit' }, { key: 'amtrak', name: 'Amtrak' },
          { key: 'path', name: 'PATH' }
      ];

      railAgencies.forEach(agency => {
          const stops = rawTransitData.rail[agency.key].stops;
          const routes = rawTransitData.rail[agency.key].routes;

          // Count stops
          const agencyStops = countPoints(stops);
          if (agencyStops > 0) {
              railCount += agencyStops;
              foundRailLines.add(agency.name);
          }
          
          // Check routes
          const agencyRoutes = getIntersectingLines(routes, 'route_id'); // Field name might vary
          if (agencyRoutes.size > 0) foundRailLines.add(agency.name);
      });

      // 3. Bus
      const busStopCount = countPoints(rawTransitData.busStops);
      const busLinesSet = getIntersectingLines(rawTransitData.busLines, 'route_short_name'); // usually route_short_name or route_id

      transitData.set({ 
          subwayStationCount: subCount, 
          subwayLines: Array.from(foundSubLines).sort(), 
          railStationCount: railCount, 
          railLines: Array.from(foundRailLines).sort(), 
          busStopCount: busStopCount, 
          busLines: Array.from(busLinesSet).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})) 
      });
  }

  // Keep Land Use as-is (Rendered Features) for now due to dataset size
  function analyzeLandUse(circleGeo) {
    if (!map) return;
    const bbox = turf.bbox(circleGeo);
    const southWest = map.project([bbox[0], bbox[1]]);
    const northEast = map.project([bbox[2], bbox[3]]);
    
    // Note: queryRenderedFeatures depends on zoom. 
    // For PLUTO, this is an acceptable tradeoff vs loading 500MB
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
                    if (!counts[cleanKey]) counts[cleanKey] = 0; 
                    counts[cleanKey] += area; 
                    totalArea += area;
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

  onMount(async () => {
    // 1. START LOADING DATA PARALLEL
    const loadData = async () => {
        try {
            // Adjust paths if your file names differ
            const responses = await Promise.all([
                fetch('/data/census_dots_full.geojson').then(r => r.json()),
                fetch('/data/subway_stations.geojson').then(r => r.json()),
                fetch('/data/subway_lines.geojson').then(r => r.json()),
                fetch('/data/bus_stops.geojson').then(r => r.json()),
                fetch('/data/bus_routes.geojson').then(r => r.json()),
                // Rails
                fetch('/data/rail_lirr_stops.geojson').then(r => r.json()),
                fetch('/data/rail_lirr_routes.geojson').then(r => r.json()),
                fetch('/data/rail_mnr_stops.geojson').then(r => r.json()),
                fetch('/data/rail_mnr_routes.geojson').then(r => r.json()),
                fetch('/data/rail_njt_stops.geojson').then(r => r.json()),
                fetch('/data/rail_njt_routes.geojson').then(r => r.json()),
                fetch('/data/rail_amtrak_stops.geojson').then(r => r.json()),
                fetch('/data/rail_amtrak_routes.geojson').then(r => r.json()),
                fetch('/data/rail_path_stops.geojson').then(r => r.json()),
                fetch('/data/rail_path_routes.geojson').then(r => r.json()),
            ]);

            rawCensusData = responses[0];
            rawTransitData.subwayStations = responses[1];
            rawTransitData.subwayLines = responses[2];
            rawTransitData.busStops = responses[3];
            rawTransitData.busLines = responses[4];
            
            // Map responses to structure
            rawTransitData.rail.lirr = { stops: responses[5], routes: responses[6] };
            rawTransitData.rail.mnr = { stops: responses[7], routes: responses[8] };
            rawTransitData.rail.njt = { stops: responses[9], routes: responses[10] };
            rawTransitData.rail.amtrak = { stops: responses[11], routes: responses[12] };
            rawTransitData.rail.path = { stops: responses[13], routes: responses[14] };

            console.log("Analysis data loaded successfully.");
            // Trigger initial analysis if we are in analysis mode
            if (map && cursorPosition) triggerUpdate(cursorPosition);

        } catch (err) {
            console.error("Error loading analysis data:", err);
        }
    };
    loadData();

    // 2. FETCH MANHATTAN BOUNDARY
    try {
        const response = await fetch('https://raw.githubusercontent.com/dwillis/nyc-maps/master/boroughs.geojson');
        const data = await response.json();
        const manhattan = data.features.find(f => f.properties.BoroName === 'Manhattan');
        if (manhattan) {
            MANHATTAN_MASK = turf.simplify(manhattan, {tolerance: 0.0001, highQuality: false});
        }
    } catch (err) {
        console.warn('Could not fetch Manhattan boundary, using World mask.', err);
    }

    // 3. INIT MAP
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

      // HIDE BUILDINGS
      layers.forEach(layer => {
          if (layer.id.includes('building')) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
      });

      // FIND INSERTION POINT
      let insertionLayerId;
      for (const layer of layers) {
        if (layer.id.includes('water') && layer.type === 'fill') {
          insertionLayerId = layer.id;
          break; 
        }
      }

      // DYNAMIC WATER DETECTION
      let waterSource = null;
      let waterSourceLayer = null;
      let waterColor = '#e0e0e0'; 
      const waterRef = layers.find(l => l.id.includes('water') && l.type === 'fill');
      if (waterRef) {
          waterSource = waterRef.source;
          waterSourceLayer = waterRef['source-layer'];
          if (waterRef.paint && waterRef.paint['fill-color']) {
             if (typeof waterRef.paint['fill-color'] === 'string') {
                waterColor = waterRef.paint['fill-color'];
             }
          }
      }

      // ADD DATA LAYERS
      map.addSource('pluto-data', { type: 'vector', url: LANDUSE_TILESET_ID });
      map.addLayer({
        'id': 'pluto-fill', 'type': 'fill', 'source': 'pluto-data', 'source-layer': LANDUSE_SOURCE_LAYER, 'minzoom': 10,
        'paint': { 
            'fill-color': [
                'match', ['to-string', ['get', 'LandUse']], 
                '01', '#F9EDDB', '1', '#F9EDDB', '02', '#F6D9CB', '2', '#F6D9CB',
                '03', '#F6D9CB', '3', '#F6D9CB', '04', '#F1B89C', '4', '#F1B89C',
                '05', '#DF7649', '5', '#DF7649', '06', '#CF4F4F', '6', '#CF4F4F',
                '07', '#BEC6CC', '7', '#BEC6CC', '08', '#BDE7F4', '8', '#BDE7F4',
                '09', '#A3D393', '9', '#A3D393', '10', '#8DA2B4', '11', '#E4E4E4', '#cccccc'
            ],
            'fill-opacity': 1 
        },
        'layout': { 'visibility': 'visible' }
      }, insertionLayerId);
      
      map.addLayer({
        'id': 'pluto-lines', 'type': 'line', 'source': 'pluto-data', 'source-layer': LANDUSE_SOURCE_LAYER,
        'paint': { 'line-width': 0.5, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.6], 'line-color': '#cccccc' },
        'layout': { 'visibility': 'visible' }
      }, insertionLayerId);

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

      // MASK A: BOTTOM
      map.addSource('mask-source', { type: 'geojson', data: WORLD_MASK });
      map.addLayer({
        id: 'mask-layer-bottom', type: 'fill', source: 'mask-source',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.85 },
        layout: { 'visibility': 'visible' }
      }, insertionLayerId);

      // TRANSIT LAYERS (TOP STACK)
      map.addSource('transit-source', { type: 'vector', url: TRANSIT_TILESET_ID });
      map.addLayer({
        id: 'transit-bus-lines', type: 'line', source: 'transit-source', 'source-layer': 'bus_routes',
        paint: { 'line-color': '#0245ef', 'line-width': 1, 'line-opacity': 0.8 },
        layout: { 'visibility': 'none' }
      });
      map.addLayer({
        id: 'transit-bus-stops', type: 'circle', source: 'transit-source', 'source-layer': 'bus_stops',
        paint: { 'circle-color': '#0245ef', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.5], 'circle-opacity': 0.6 },
        layout: { 'visibility': 'none' }
      });
      map.addLayer({
        id: 'transit-subway-lines', type: 'line', source: 'transit-source', 'source-layer': 'subway_lines',
        paint: { 'line-width': 2.5, 'line-color': '#ffd73e' },
        layout: { 'visibility': 'none' }
      });
      
      ['rail_lirr', 'rail_mnr', 'rail_njt', 'rail_amtrak', 'rail_path'].forEach(agency => {
          map.addLayer({
            id: `transit-rail-lines-${agency}_routes`, type: 'line', source: 'transit-source', 'source-layer': `${agency}_routes`,
            paint: { 'line-color': '#ff98ab', 'line-width': 1.5 }, layout: { 'visibility': 'none' }
          });
      });

      map.addLayer({
        id: 'transit-subway-stations', type: 'circle', source: 'transit-source', 'source-layer': 'subway_stations',
        paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffd73e' },
        layout: { 'visibility': 'none' }
      });

      ['rail_lirr', 'rail_mnr', 'rail_njt', 'rail_amtrak', 'rail_path'].forEach(agency => {
          map.addLayer({
            id: `transit-rail-stations-${agency}_stops`, type: 'circle', source: 'transit-source', 'source-layer': `${agency}_stops`,
            paint: { 'circle-radius': 3, 'circle-color': '#ff98ab', 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' }, layout: { 'visibility': 'none' }
          });
      });

      // MASK B: TOP
      map.addLayer({
        id: 'mask-layer-top', type: 'fill', source: 'mask-source',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.85 },
        layout: { 'visibility': 'none' } 
      });

      // WATER RESCUE OVERLAY
      if (waterSource && waterSourceLayer) {
        map.addLayer({
            'id': 'water-rescue', 'type': 'fill', 'source': waterSource, 'source-layer': waterSourceLayer,
            'paint': { 'fill-color': waterColor, 'fill-opacity': 1 },
            'layout': { 'visibility': 'none' } 
        });
      }

      // LENS OUTLINE
      map.addSource('lens-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'lens-outline', type: 'line', source: 'lens-source',
        paint: { 'line-color': '#333333', 'line-width': 1.5, 'line-dasharray': [2, 3] }
      });

      map.on('mousemove', (e) => triggerUpdate(e.lngLat));
      updateMapState(map.getCenter());
    });
  });

  onDestroy(() => {
    unsubscribeRadius();
    unsubscribeLayer();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (map) map.remove();
  });
</script>

<div class="map-wrap" bind:this={mapContainer}></div>

<style>
  .map-wrap { width: 100%; height: 100%; position: relative; }
</style>