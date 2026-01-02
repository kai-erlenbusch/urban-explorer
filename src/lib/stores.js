import { writable } from 'svelte/store';

// 1. Controls which layer is active ('landuse' or 'demographics')
export const activeLayer = writable('landuse');

// 2. Land Use Data
export const analysisData = writable({
  count: 0,
  area: 0,
  breakdown: {},
  entropy: 0
});

// 3. Demographics Data
export const demographicsData = writable({
  totalPeople: 0,
  density: 0,
  ethnicityBreakdown: {}
});

// 4. Shared State (Radius)
export const radius = writable(0.25);