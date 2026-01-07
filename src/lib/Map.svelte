<script>
  console.log(">>> HYBRID MAP COMPONENT LOADED <<<");
  
  import { onMount, onDestroy } from 'svelte';
  import { activeLayer, analysisData, demographicsData, transitData, radius } from './stores.js';
  import { LU_CATEGORIES } from './constants.js';

  import maplibregl from 'maplibre-gl';
  import * as turf from '@turf/turf';
  import 'maplibre-gl/dist/maplibre-gl.css';
  
  import AnalysisWorker from './analysis.worker.js?worker';

  let map;
  let mapContainer;
  let currentRadius;
  let cursorPosition = null;
  let currentMode = 'landuse';
  
  // Worker State
  let worker;
  let isWorkerBusy = false;
  let pendingWorkerRequest = null;

  // UI Throttling
  let animationFrameId;
  let isUpdating = false;

  // --- CONFIGURATION ---
  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!MAPBOX_TOKEN) console.error("Mapbox Token is missing!");
  
  const LANDUSE_TILESET_ID = 'mapbox://kai-erlenbusch.9a769cf2';
  const LANDUSE_SOURCE_LAYER = 'mn_mappluto-d8n2zk';
  const CENSUS_TILESET_ID = 'mapbox://kai-erlenbusch.0ua9vbjj';
  const CENSUS_SOURCE_LAYER = 'census_dots_full';
  const TRANSIT_TILESET_ID = 'mapbox://kai-erlenbusch.ydqfgcin';

  let MANHATTAN_MASK = null;
  const WORLD_MASK = turf.polygon([[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]);

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

    // 2. Toggle Masks
    if (map.getLayer('mask-layer-top')) map.setLayoutProperty('mask-layer-top', 'visibility', isTransit ? 'visible' : 'none');
    if (map.getLayer('mask-layer-bottom')) map.setLayoutProperty('mask-layer-bottom', 'visibility', isTransit ? 'none' : 'visible');
    if (map.getLayer('water-rescue')) map.setLayoutProperty('water-rescue', 'visibility', isTransit ? 'visible' : 'none');
    
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
    
    // 1. UPDATE VISUALS (Always runs 60fps)
    if (map.getSource('mask-source')) {
        let maskBase = MANHATTAN_MASK || WORLD_MASK;
        let maskGeometry;
        try { maskGeometry = turf.difference(turf.featureCollection([maskBase, circleGeo])); } 
        catch(e) { maskGeometry = maskBase; }
        if (maskGeometry) map.getSource('mask-source').setData(maskGeometry);
    }
    if (map.getSource('lens-source')) {
        map.getSource('lens-source').setData(circleGeo);
    }

    // 2. RUN ANALYSIS (HYBRID APPROACH)
    // If Land Use, run on MAIN THREAD (restored logic)
    if (currentMode === 'landuse') {
        analyzeLandUseMainThread(circleGeo);
    } 
    // If Transit/Demographics, run in WORKER (optimized logic)
    else if (worker) {
        const payload = {
            centerPoint: [lngLat.lng, lngLat.lat],
            radius: currentRadius,
            mode: currentMode
        };
        if (!isWorkerBusy) {
            isWorkerBusy = true;
            worker.postMessage({ type: 'ANALYZE', payload });
        } else {
            pendingWorkerRequest = payload;
        }
    }
  }

  // --- RESTORED MAIN THREAD ANALYSIS FOR LAND USE ---
  function analyzeLandUseMainThread(circleGeo) {
    if (!map) return;
    const bbox = turf.bbox(circleGeo);
    const southWest = map.project([bbox[0], bbox[1]]);
    const northEast = map.project([bbox[2], bbox[3]]);
    
    // Query visible features (view-dependent)
    const features = map.queryRenderedFeatures([southWest, northEast], { layers: ['pluto-fill'] });
    
    let totalArea = 0; 
    let counts = {};
    const seenIds = new Set();
    
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
    worker = new AnalysisWorker();
    
    worker.onmessage = (e) => {
        const { type, data } = e.data;
        
        if (type === 'RESULTS_DEMOGRAPHICS' && data) demographicsData.set(data);
        else if (type === 'RESULTS_TRANSIT' && data) transitData.set(data);
        else if (type === 'DATA_LOADED') {
             const c = map.getCenter();
             if(c) triggerUpdate(c); 
        }

        isWorkerBusy = false;

        if (pendingWorkerRequest) {
            const nextPayload = pendingWorkerRequest;
            pendingWorkerRequest = null;
            // Only re-trigger worker if next request is NOT landuse (since landuse is now main thread)
            if (nextPayload.mode !== 'landuse') {
                 isWorkerBusy = true;
                 worker.postMessage({ type: 'ANALYZE', payload: nextPayload });
            }
        }
    };

    worker.postMessage({ type: 'LOAD_DATA' });

    try {
        const response = await fetch('https://raw.githubusercontent.com/dwillis/nyc-maps/master/boroughs.geojson');
        const data = await response.json();
        const manhattan = data.features.find(f => f.properties.BoroName === 'Manhattan');
        if (manhattan) MANHATTAN_MASK = turf.simplify(manhattan, {tolerance: 0.0001, highQuality: false});
    } catch (err) { console.warn('Using World mask.'); }

    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-73.985, 40.748], 
      zoom: 13, minZoom: 9, 
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
      layers.forEach(l => { if (l.id.includes('building')) map.setLayoutProperty(l.id, 'visibility', 'none'); });

      let insertionLayerId;
      for (const l of layers) { if (l.id.includes('water') && l.type === 'fill') { insertionLayerId = l.id; break; } }
      
      let waterSource = null;
      let waterSourceLayer = null;
      let waterColor = '#e0e0e0'; 
      const waterRef = layers.find(l => l.id.includes('water') && l.type === 'fill');
      if (waterRef) {
          waterSource = waterRef.source;
          waterSourceLayer = waterRef['source-layer'];
          if (waterRef.paint && waterRef.paint['fill-color']) {
             if (typeof waterRef.paint['fill-color'] === 'string') waterColor = waterRef.paint['fill-color'];
          }
      }

      // --- 2. DYNAMIC COLOR GENERATION ---
      const landUseColorExpression = ['match', ['to-string', ['get', 'LandUse']]];
      LU_CATEGORIES.forEach(cat => {
          landUseColorExpression.push(cat.code, cat.color);
          if (cat.code.length === 1) landUseColorExpression.push(`0${cat.code}`, cat.color);
          else if (cat.code.startsWith('0')) landUseColorExpression.push(cat.code.substring(1), cat.color);
      });
      landUseColorExpression.push('#cccccc'); 

      // ADD DATA LAYERS
      map.addSource('pluto-data', { type: 'vector', url: LANDUSE_TILESET_ID });
      map.addLayer({
        'id': 'pluto-fill', 'type': 'fill', 'source': 'pluto-data', 'source-layer': LANDUSE_SOURCE_LAYER, 'minzoom': 10,
        'paint': { 
            'fill-color': landUseColorExpression, 
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

      map.addSource('mask-source', { type: 'geojson', data: WORLD_MASK });
      map.addLayer({
        id: 'mask-layer-bottom', type: 'fill', source: 'mask-source',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.85 },
        layout: { 'visibility': 'visible' }
      }, insertionLayerId);

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

      map.addLayer({
        id: 'mask-layer-top', type: 'fill', source: 'mask-source',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.85 },
        layout: { 'visibility': 'none' } 
      });

      if (waterSource && waterSourceLayer) {
        map.addLayer({
            'id': 'water-rescue', 'type': 'fill', 'source': waterSource, 'source-layer': waterSourceLayer,
            'paint': { 'fill-color': waterColor, 'fill-opacity': 1 },
            'layout': { 'visibility': 'none' } 
        });
      }

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
    if (worker) worker.terminate();
    if (map) map.remove();
  });
</script>

<div class="map-wrap" bind:this={mapContainer}></div>

<style>
  .map-wrap { width: 100%; height: 100%; position: relative; }
</style>