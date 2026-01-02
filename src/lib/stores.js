import { writable } from 'svelte/store';

export const activeLayer = writable('landuse');

// Land Use Data
export const analysisData = writable({
  count: 0,
  area: 0,
  breakdown: {},
  entropy: 0
});

// Demographics Data
export const demographicsData = writable({
  totalPeople: 0,
  density: 0,
  ethnicityBreakdown: {},
  // New Fields
  diversityIndex: 0,
  percentFemale: 0,
  ageBreakdown: {
    '0-4': 0,
    '5-17': 0,
    '18-34': 0,
    '35-59': 0,
    '60+': 0
  }
});

export const radius = writable(0.25);