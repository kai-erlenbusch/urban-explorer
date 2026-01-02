<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'; // Added createEventDispatcher
  import { activeLayer, analysisData, demographicsData, radius } from './stores.js';
  import maplibregl from 'maplibre-gl';
  import * as turf from '@turf/turf';
  import 'maplibre-gl/dist/maplibre-gl.css';

  const dispatch = createEventDispatcher(); // Initialize Dispatcher

  let map;
  let mapContainer;
  let currentRadius;
  let cursorPosition = null;
  let currentMode = 'landuse';

  // --- CONFIGURATION ---
  const MAPBOX_TOKEN = 'pk.eyJ1Ijoia2FpLWVybGVuYnVzY2giLCJhIjoiY21qZzM5Z3FnMHk3MTNkcHNrcDJ0ajFpNyJ9.X4SxJOFBNAxGo8G5qHLKXA';
  
  const LANDUSE_TILESET_ID = 'mapbox://kai-erlenbusch.9a769cf2';
  const LANDUSE_SOURCE_LAYER = 'mn_mappluto-d8n2zk';

  const CENSUS_TILESET_ID = 'mapbox://kai-erlenbusch.cxab71ns';
  const CENSUS_SOURCE_LAYER = 'census_dots-bf63fb';

  const WORLD_MASK = turf.polygon([[
    [-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]
  ]]);

  const unsubscribeRadius = radius.subscribe(value => {
    currentRadius = value;
    if (map && cursorPosition) updateMapState(cursorPosition);
  });

  const unsubscribeLayer = activeLayer.subscribe(value => {
    currentMode = value;
    if (!map || !map.isStyleLoaded()) return;
    
    const isLandUse = value === 'landuse';

    if (map.getLayer('pluto-fill')) map.setLayoutProperty('pluto-fill', 'visibility', isLandUse ? 'visible' : 'none');
    if (map.getLayer('pluto-lines')) map.setLayoutProperty('pluto-lines', 'visibility', isLandUse ? 'visible' : 'none');
    if (map.getLayer('mask-layer')) map.setLayoutProperty('mask-layer', 'visibility', isLandUse ? 'visible' : 'none');
    
    if (map.getLayer('census-dots')) map.setLayoutProperty('census-dots', 'visibility', isLandUse ? 'none' : 'visible');

    if (cursorPosition) updateMapState(cursorPosition);
  });

  function updateMapState(lngLat) {
    if (!map) return;
    cursorPosition = lngLat;

    const centerPoint = turf.point([lngLat.lng, lngLat.lat]);
    const circleGeo = turf.circle(centerPoint, currentRadius, { steps: 64, units: 'miles' });

    if (map.getSource('mask-source')) {
        const maskGeometry = turf.difference(turf.featureCollection([WORLD_MASK, circleGeo]));
        map.getSource('mask-source').setData(maskGeometry);
    }

    if (currentMode === 'landuse') {
        analyzeLandUse(circleGeo);
    } else {
        analyzeDemographics(circleGeo);
    }
  }

  function analyzeLandUse(circleGeo) {
    const bbox = turf.bbox(circleGeo);
    const southWest = map.project([bbox[0], bbox[1]]);
    const northEast = map.project([bbox[2], bbox[3]]);

    const features = map.queryRenderedFeatures([southWest, northEast], { layers: ['pluto-fill'] });
    
    let totalArea = 0;
    let counts = {};
    
    features.forEach(f => {
       const rawLU = f.properties.LandUse; 
       
       // FORCE AREA CALCULATION (Since LotArea is missing in tiles)
       const area = turf.area(f) * 0.000247105; 
       
       if (rawLU) {
            const cleanKey = parseInt(String(rawLU), 10).toString();
            if (cleanKey !== "NaN") {
                if (!counts[cleanKey]) counts[cleanKey] = 0;
                counts[cleanKey] += area;
                totalArea += area;
            }
       }
    });

    let entropy = 0;
    if (totalArea > 0) {
        let H = 0;
        Object.values(counts).forEach(a => {
            const p = a / totalArea;
            if (p > 0) H -= p * Math.log(p);
        });
        entropy = H / Math.log(11); 
    }

    const result = {
        count: features.length,
        area: totalArea,
        breakdown: counts,
        entropy: entropy
    };

    // CRITICAL FIX: Dispatch event so App.svelte passes data to Sidebar
    dispatch('analysis', result); 
    
    // Also update store for safety
    analysisData.set(result);
  }

  function analyzeDemographics(circleGeo) {
    const features = map.queryRenderedFeatures({ layers: ['census-dots'] });
    let totalPeople = 0;
    let ethnicityCounts = {};

    features.forEach(f => {
        const pt = turf.point(f.geometry.coordinates);
        if (turf.booleanPointInPolygon(pt, circleGeo)) {
            const pop = f.properties.pop_est || 1; 
            const eth = f.properties.ethnicity || 'Other';
            
            totalPeople += pop;
            if (!ethnicityCounts[eth]) ethnicityCounts[eth] = 0;
            ethnicityCounts[eth] += pop;
        }
    });

    demographicsData.set({
        totalPeople: totalPeople,
        density: totalPeople / (Math.PI * currentRadius * currentRadius * 640), 
        ethnicityBreakdown: ethnicityCounts
    });
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-73.985, 40.748], 
      zoom: 13,
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
      // 1. LAND USE
      map.addSource('pluto-data', { type: 'vector', url: LANDUSE_TILESET_ID });
      map.addLayer({
        'id': 'pluto-fill',
        'type': 'fill',
        'source': 'pluto-data',
        'source-layer': LANDUSE_SOURCE_LAYER,
        'paint': {
          'fill-color': [
            'match', ['to-string', ['get', 'LandUse']], 
            '01', '#F9EDDB', '1', '#F9EDDB',
            '02', '#F6D9CB', '2', '#F6D9CB',
            '03', '#F6D9CB', '3', '#F6D9CB',
            '04', '#F1B89C', '4', '#F1B89C',
            '05', '#DF7649', '5', '#DF7649',
            '06', '#CF4F4F', '6', '#CF4F4F',
            '07', '#BEC6CC', '7', '#BEC6CC',
            '08', '#BDE7F4', '8', '#BDE7F4',
            '09', '#A3D393', '9', '#A3D393',
            '10', '#8DA2B4', '11', '#E4E4E4',
            '#cccccc'
          ],
          'fill-opacity': 1
        },
        'layout': { 'visibility': 'visible' }
      });

      map.addLayer({
        id: 'pluto-lines',
        type: 'line',
        source: 'pluto-data',
        'source-layer': LANDUSE_SOURCE_LAYER,
        paint: {
          'line-width': 0.5,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15.5, 0.8],
          'line-color': ['interpolate', ['linear'], ['zoom'], 14, '#cccccc', 16, '#444444']
        },
        'layout': { 'visibility': 'visible' }
      });

      // 2. DEMOGRAPHICS
      map.addSource('census-source', { type: 'vector', url: CENSUS_TILESET_ID });
      map.addLayer({
        id: 'census-dots',
        type: 'circle',
        source: 'census-source', 
        'source-layer': CENSUS_SOURCE_LAYER,
        paint: {
          'circle-radius': 2,
          'circle-color': [
              'match', ['get', 'ethnicity'],
              'Asian', '#E55E5E',
              'Black', '#3182CE',
              'Hispanic', '#DD6B20',
              'White', '#38A169',
              '#718096'
          ],
          'circle-opacity': 0.8
        },
        'layout': { 'visibility': 'none' }
      });

      // 3. MASK
      map.addSource('mask-source', { type: 'geojson', data: WORLD_MASK });
      map.addLayer({
        id: 'mask-layer',
        type: 'fill',
        source: 'mask-source',
        paint: {
          'fill-color': '#ffffff',
          'fill-opacity': 0.85
        }
      });

      map.on('mousemove', (e) => {
          updateMapState(e.lngLat);
      });
      
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