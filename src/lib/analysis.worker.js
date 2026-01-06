import * as turf from '@turf/turf';

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

// --- MESSAGE HANDLER ---
self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'LOAD_DATA') {
        await loadData();
        self.postMessage({ type: 'DATA_LOADED' });
    }

    if (type === 'ANALYZE') {
        const { centerPoint, radius, mode } = payload;
        
        if (mode === 'demographics') {
            const results = analyzeDemographics(centerPoint, radius);
            self.postMessage({ type: 'RESULTS_DEMOGRAPHICS', data: results });
        } else if (mode === 'transit') {
            const results = analyzeTransit(centerPoint, radius);
            self.postMessage({ type: 'RESULTS_TRANSIT', data: results });
        }
    }
};

// --- DATA LOADER ---
async function loadData() {
    try {
        const responses = await Promise.all([
            fetch('/data/census_dots_full.geojson').then(r => r.json()), // The correct FULL file
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
        
        rawTransitData.rail.lirr = { stops: responses[5], routes: responses[6] };
        rawTransitData.rail.mnr = { stops: responses[7], routes: responses[8] };
        rawTransitData.rail.njt = { stops: responses[9], routes: responses[10] };
        rawTransitData.rail.amtrak = { stops: responses[11], routes: responses[12] };
        rawTransitData.rail.path = { stops: responses[13], routes: responses[14] };
        
        console.log("Worker: Data loaded successfully.");
    } catch (err) {
        console.error("Worker: Failed to load data", err);
    }
}

// --- ANALYSIS FUNCTIONS ---

function analyzeDemographics(centerPoint, radius) {
    if (!rawCensusData) return null;

    const circleGeo = turf.circle(centerPoint, radius, { steps: 64, units: 'miles' });
    const bbox = turf.bbox(circleGeo); 
    const radiusKm = radius * 1.60934;

    let totalPeople = 0;
    let ethnicityCounts = {}; 
    let femaleCount = 0; 
    let ageCounts = { '0-4': 0, '5-17': 0, '18-34': 0, '35-59': 0, '60+': 0 };

    // Dynamic Key Detection
    const sampleProps = rawCensusData.features[0]?.properties || {};
    const keys = Object.keys(sampleProps);
    const keyEth = keys.find(k => k.toLowerCase() === 'ethnicity') || 'ethnicity';
    const keyAge = keys.find(k => k.toLowerCase() === 'age_group') || 'age_group';
    const keySex = keys.find(k => k.toLowerCase() === 'sex') || 'sex';
    const keyPop = keys.find(k => k.toLowerCase() === 'pop_est') || 'pop_est';

    for (const f of rawCensusData.features) {
        const coords = f.geometry.coordinates;

        // BBox Check
        if (coords[0] < bbox[0] || coords[0] > bbox[2] || coords[1] < bbox[1] || coords[1] > bbox[3]) continue;

        // Distance Check
        const pt = turf.point(coords);
        if (turf.distance(centerPoint, pt, { units: 'kilometers' }) <= radiusKm) {
             const props = f.properties;
             const pop = props[keyPop] || 1; 
             const eth = props[keyEth] || 'Other';
 
             totalPeople += pop;
 
             if (!ethnicityCounts[eth]) ethnicityCounts[eth] = 0; 
             ethnicityCounts[eth] += pop;
 
             const rawSex = props[keySex];
             const isFemale = rawSex === 'Female' || rawSex === 'female' || rawSex === 'F' || rawSex === 'f' || rawSex == 2;
             if (isFemale) femaleCount += pop;
 
             let rawAge = props[keyAge];
             // Normalization logic
             if (!ageCounts.hasOwnProperty(rawAge)) {
                 if (rawAge === 'Under 5') rawAge = '0-4';
                 else if (rawAge === '5 to 17' || rawAge === '5-17') rawAge = '5-17';
                 else if (rawAge === '18 to 34' || rawAge === '18-34') rawAge = '18-34';
                 else if (rawAge === '35 to 59' || rawAge === '35-59') rawAge = '35-59';
                 else if (rawAge === '60 and over' || rawAge === '60+') rawAge = '60+';
             }

             if (rawAge && ageCounts[rawAge] !== undefined) ageCounts[rawAge] += pop;
        }
    }

    let sumSquares = 0;
    if (totalPeople > 0) { 
        Object.values(ethnicityCounts).forEach(count => { 
            const p = count / totalPeople; 
            sumSquares += p * p; 
        });
    }

    return { 
        totalPeople, 
        density: totalPeople / (Math.PI * radius * radius * 640), 
        ethnicityBreakdown: ethnicityCounts, 
        diversityIndex: totalPeople > 0 ? (1 - sumSquares) : 0, 
        percentFemale: totalPeople > 0 ? (femaleCount / totalPeople) * 100 : 0, 
        ageBreakdown: ageCounts 
    };
}

function analyzeTransit(centerPoint, radius) {
      if (!rawTransitData.subwayStations) return null;

      const circleGeo = turf.circle(centerPoint, radius, { steps: 32, units: 'miles' });
      const bbox = turf.bbox(circleGeo);

      const countPoints = (featureCollection) => {
          if (!featureCollection) return 0;
          const pts = turf.pointsWithinPolygon(featureCollection, circleGeo);
          return pts.features.length;
      };

      const getIntersectingLines = (featureCollection, nameField) => {
          const found = new Set();
          if (!featureCollection) return found;

          for (const f of featureCollection.features) {
              const fBbox = turf.bbox(f);
              const overlap = !(bbox[0] > fBbox[2] || bbox[2] < fBbox[0] || bbox[1] > fBbox[3] || bbox[3] < fBbox[1]);
              
              if (overlap) {
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
      
      subStationsInside.features.forEach(f => {
          const linesStr = f.properties.trains || f.properties.lines || f.properties.name || "";
          const parts = linesStr.split(/[\s-]+/); 
          parts.forEach(p => { if (/^[A-Z0-9]+$/.test(p) && p.length <= 2) foundSubLines.add(p); });
      });
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

          const agencyStops = countPoints(stops);
          if (agencyStops > 0) {
              railCount += agencyStops;
              foundRailLines.add(agency.name);
          }
          
          const agencyRoutes = getIntersectingLines(routes, 'route_id'); 
          if (agencyRoutes.size > 0) foundRailLines.add(agency.name);
      });

      // 3. Bus
      const busStopCount = countPoints(rawTransitData.busStops);
      const busLinesSet = getIntersectingLines(rawTransitData.busLines, 'route_short_name'); 

      return { 
          subwayStationCount: subCount, 
          subwayLines: Array.from(foundSubLines).sort(), 
          railStationCount: railCount, 
          railLines: Array.from(foundRailLines).sort(), 
          busStopCount: busStopCount, 
          busLines: Array.from(busLinesSet).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})) 
      };
}