<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import * as turf from '@turf/turf';
  import 'maplibre-gl/dist/maplibre-gl.css';

  const dispatch = createEventDispatcher();

  export let radius = 0.25;

  let map = null;
  let mapContainer;
  let currentLngLat = null;

  // --- CONFIGURATION ---
  const MAPBOX_TOKEN = 'pk.eyJ1IjoibW9ycGhvY29kZSIsImEiOiJVMnRPS0drIn0.QrB-bpBR5Tgnxa6nc9TqmQ';
  const TILESET_ID = 'mapbox://kai-erlenbusch.9a769cf2';
  const SOURCE_LAYER_NAME = 'mn_mappluto-d8n2zk';

  const WORLD_MASK = turf.polygon([[
    [-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]
  ]]);

  // Reactive Statement
  $: if (map && map.getSource('mask-source') && currentLngLat && radius) {
    runSpatialEngine(currentLngLat);
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-73.985, 40.748],
      zoom: 13,
      pitch: 0,
      transformRequest: (url) => {
        if (url.startsWith("mapbox://")) {
          return {
            url: url.replace("mapbox://", "https://api.mapbox.com/v4/") + `.json?access_token=${MAPBOX_TOKEN}`,
            headers: { "Content-Type": "application/json" }
          };
        }
        if (url.includes("api.mapbox.com")) {
          return { url: url.indexOf("?") > -1 ? url + `&access_token=${MAPBOX_TOKEN}` : url + `?access_token=${MAPBOX_TOKEN}` }
        }
        return { url };
      }
    });

    map.on('load', () => {
      map.addSource('pluto-data', { type: 'vector', url: TILESET_ID });

      // 1. COLORS
      map.addLayer({
        id: 'pluto-fill',
        type: 'fill',
        source: 'pluto-data',
        'source-layer': SOURCE_LAYER_NAME,
        paint: {
          'fill-color': [
            'match',
            ['to-string', ['get', 'LandUse']],
            '01', '#F9EDDB', '1', '#F9EDDB',
            '02', '#F6D9CB', '2', '#F6D9CB',
            '03', '#F6D9CB', '3', '#F6D9CB',
            '04', '#F1B89C', '4', '#F1B89C',
            '05', '#DF7649', '5', '#DF7649',
            '06', '#CF4F4F', '6', '#CF4F4F',
            '07', '#BEC6CC', '7', '#BEC6CC',
            '08', '#BDE7F4', '8', '#BDE7F4',
            '09', '#A3D393', '9', '#A3D393',
            '10', '#8DA2B4',
            '11', '#E4E4E4',
            '#cccccc'
          ],
          'fill-opacity': 1
        }
      });

      // 2. LINES
      map.addLayer({
        id: 'pluto-lines',
        type: 'line',
        source: 'pluto-data',
        'source-layer': SOURCE_LAYER_NAME,
        paint: {
          'line-width': 0.5,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15.5, 0.8],
          'line-color': ['interpolate', ['linear'], ['zoom'], 14, '#cccccc', 16, '#444444']
        }
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
        currentLngLat = [e.lngLat.lng, e.lngLat.lat];
      });
    });
  });

  function runSpatialEngine(center) {
    if (!map.getLayer('pluto-fill')) return;

    const circle = turf.circle(center, radius, { steps: 64, units: 'miles' });
    const maskGeometry = turf.difference(turf.featureCollection([WORLD_MASK, circle]));
    map.getSource('mask-source').setData(maskGeometry);

    const bbox = turf.bbox(circle);
    const southWest = map.project([bbox[0], bbox[1]]);
    const northEast = map.project([bbox[2], bbox[3]]);
    
    const candidates = map.queryRenderedFeatures(
      [southWest, northEast], 
      { layers: ['pluto-fill'] }
    );

    const insideFeatures = candidates.filter(feature => {
      return turf.booleanIntersects(feature, circle);
    });

    // --- ANALYTICS ENGINE ---
    const breakdown = {};
    let totalArea = 0;

    insideFeatures.forEach(feature => {
      const featureAcres = (feature.properties.LotArea || turf.area(feature)) * 0.000247105;
      totalArea += featureAcres;

      const rawLU = feature.properties.LandUse;
      if (rawLU) {
        const stringLU = String(rawLU);
        const cleanKey = parseInt(stringLU, 10).toString();
        
        if (cleanKey && cleanKey !== "NaN") {
          breakdown[cleanKey] = (breakdown[cleanKey] || 0) + featureAcres;
        }
      }
    });

    // --- ENTROPY CALCULATION (Shannon Index) ---
    let entropy = 0;
    if (totalArea > 0) {
      let H = 0;
      Object.values(breakdown).forEach(area => {
        const p = area / totalArea; // Proportion of this category
        if (p > 0) {
          H -= p * Math.log(p); // -p * ln(p)
        }
      });
      // Normalize (0 to 1) by dividing by ln(11 categories)
      const maxEntropy = Math.log(11);
      entropy = H / maxEntropy;
    }

    dispatch('analysis', {
      count: insideFeatures.length,
      area: totalArea,
      breakdown: breakdown,
      entropy: entropy // <--- Sending the Score!
    });
  }

  onDestroy(() => {
    if (map) map.remove();
  });
</script>

<div class="map-wrap" bind:this={mapContainer}></div>

<style>
  .map-wrap { width: 100%; height: 100%; position: relative; }
</style>