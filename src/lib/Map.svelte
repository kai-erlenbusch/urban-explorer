<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { activeLayer, analysisData, demographicsData, radius } from './stores.js';
  import maplibregl from 'maplibre-gl';
  import * as turf from '@turf/turf';
  import 'maplibre-gl/dist/maplibre-gl.css';

  const dispatch = createEventDispatcher();

  let map;
  let mapContainer;
  let currentRadius;
  let cursorPosition = null;
  let currentMode = 'landuse';

  // --- CONFIGURATION ---
  const MAPBOX_TOKEN = 'pk.eyJ1Ijoia2FpLWVybGVuYnVzY2giLCJhIjoiY21qZzM5Z3FnMHk3MTNkcHNrcDJ0ajFpNyJ9.X4SxJOFBNAxGo8G5qHLKXA';
  
  const LANDUSE_TILESET_ID = 'mapbox://kai-erlenbusch.9a769cf2';
  const LANDUSE_SOURCE_LAYER = 'mn_mappluto-d8n2zk';

  // --- NEW FULL DATASET ---
  const CENSUS_TILESET_ID = 'mapbox://kai-erlenbusch.0ua9vbjj';
  const CENSUS_SOURCE_LAYER = 'census_dots_full'; // Internal name from Tippecanoe

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

    // Toggle Layers
    if (map.getLayer('pluto-fill')) map.setLayoutProperty('pluto-fill', 'visibility', isLandUse ? 'visible' : 'none');
    if (map.getLayer('pluto-lines')) map.setLayoutProperty('pluto-lines', 'visibility', isLandUse ? 'visible' : 'none');
    
    if (map.getLayer('census-dots')) map.setLayoutProperty('census-dots', 'visibility', isLandUse ? 'none' : 'visible');

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

    // 1. Update Visual Mask
    if (map.getSource('mask-source')) {
        const maskGeometry = turf.difference(turf.featureCollection([WORLD_MASK, circleGeo]));
        map.getSource('mask-source').setData(maskGeometry);
    }

    // 2. Run Analysis based on Active Tab
    if (currentMode === 'landuse') {
        analyzeLandUse(circleGeo);
    } else {
        analyzeDemographics(centerPoint);
    }
  }

  // --- LAND USE LOGIC (STABLE) ---
  function analyzeLandUse(circleGeo) {
    const bbox = turf.bbox(circleGeo);
    const southWest = map.project([bbox[0], bbox[1]]);
    const northEast = map.project([bbox[2], bbox[3]]);

    const features = map.queryRenderedFeatures([southWest, northEast], { layers: ['pluto-fill'] });
    
    let totalArea = 0;
    let counts = {};
    const seenIds = new Set();
    const insideFeatures = [];

    for (const feature of features) {
        const uniqueId = feature.id || feature.properties.BBL || feature.properties.LotArea;
        if (seenIds.has(uniqueId)) continue;

        if (turf.booleanIntersects(feature, circleGeo)) {
            seenIds.add(uniqueId);
            insideFeatures.push(feature);
        }
    }

    insideFeatures.forEach(f => {
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

    analysisData.set({
        count: insideFeatures.length,
        area: totalArea,
        breakdown: counts,
        entropy: entropy
    });
  }

  // --- DEMOGRAPHICS LOGIC (FULL DATA) ---
  function analyzeDemographics(centerPoint) {
    const features = map.queryRenderedFeatures({ layers: ['census-dots'] });
    
    let totalPeople = 0;
    let ethnicityCounts = {};
    let femaleCount = 0; 
    let ageCounts = { '0-4': 0, '5-17': 0, '18-34': 0, '35-59': 0, '60+': 0 };
    
    const radiusKm = currentRadius * 1.60934;

    features.forEach(f => {
        const pt = turf.point(f.geometry.coordinates);
        const distance = turf.distance(centerPoint, pt, {units: 'kilometers'});
        
        if (distance <= radiusKm) {
            // 1. ETHNICITY
            const eth = f.properties.ethnicity || 'Other';
            const pop = f.properties.pop_est || 1; 
            
            totalPeople += pop;
            if (!ethnicityCounts[eth]) ethnicityCounts[eth] = 0;
            ethnicityCounts[eth] += pop;

            // 2. SEX (From new tileset)
            // Python script saved it as 'sex' (Male/Female)
            const sex = f.properties.sex;
            if (sex === 'Female') femaleCount += pop;

            // 3. AGE (From new tileset)
            // Python script saved it as 'age_group'
            const age = f.properties.age_group;
            if (age && ageCounts[age] !== undefined) {
                ageCounts[age] += pop;
            }
        }
    });

    // --- CALCULATE DIVERSITY INDEX ---
    let sumSquares = 0;
    if (totalPeople > 0) {
        Object.values(ethnicityCounts).forEach(count => {
            const p = count / totalPeople;
            sumSquares += p * p;
        });
    }
    const diversityIndex = totalPeople > 0 ? (1 - sumSquares) : 0;

    demographicsData.set({
        totalPeople: totalPeople,
        density: totalPeople / (Math.PI * currentRadius * currentRadius * 640), 
        ethnicityBreakdown: ethnicityCounts,
        diversityIndex: diversityIndex,
        percentFemale: totalPeople > 0 ? (femaleCount / totalPeople) * 100 : 0,
        ageBreakdown: ageCounts
    });
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-73.985, 40.748], 
      zoom: 13,
      minZoom: 8, 
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
        'id': 'pluto-lines',
        'type': 'line',
        'source': 'pluto-data',
        'source-layer': LANDUSE_SOURCE_LAYER,
        'paint': {
            'line-width': 0.5,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15.5, 0.8],
            'line-color': '#cccccc'
        },
        'layout': { 'visibility': 'visible' }
      });

      // 2. DEMOGRAPHICS (DOTS)
      map.addSource('census-source', { type: 'vector', url: CENSUS_TILESET_ID });
      map.addLayer({
        id: 'census-dots',
        type: 'circle',
        source: 'census-source', 
        'source-layer': CENSUS_SOURCE_LAYER,
        minzoom: 8, 
        paint: {
          'circle-radius': {
            'base': 1.5,
            'stops': [[8, 1], [16, 4]]
          },
          'circle-color': [
             'match', ['get', 'ethnicity'],
             'Asian', '#eeae9f',
             'Black', '#68c582',
             'Hispanic', '#f0ba5e',
             'White', '#4674ea',
             '#b1b1b1' // Fallback / Other
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
      
      // Initialize
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