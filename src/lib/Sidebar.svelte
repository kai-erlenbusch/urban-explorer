<script>
  import { analysisData, demographicsData, radius, activeLayer } from './stores.js';

  // --- CONFIGURATION ---
  const LU_CATEGORIES = [
    { code: '1', label: 'One & Two Family Buildings', color: '#F9EDDB' },
    { code: '2', label: 'Multi-Family Walk-Up Buildings', color: '#F6D9CB' },
    { code: '3', label: 'Multi-Family Elevator Buildings', color: '#F6D9CB' },
    { code: '4', label: 'Residential & Commercial Mix', color: '#F1B89C' },
    { code: '5', label: 'Commercial & Office', color: '#DF7649' },
    { code: '6', label: 'Industrial & Manufacturing', color: '#CF4F4F' },
    { code: '7', label: 'Transportation & Utility', color: '#BEC6CC' },
    { code: '8', label: 'Public Facilities & Institutions', color: '#BDE7F4' },
    { code: '9', label: 'Open Space & Outdoor Recreation', color: '#A3D393' },
    { code: '10', label: 'Parking Facilities', color: '#8DA2B4' },
    { code: '11', label: 'Vacant Land', color: '#E4E4E4' },
  ];

  // MORPHOCODE COLOR SCHEME
  const ETH_COLORS = {
    'Asian': '#eeae9f',      // Pastel Pink
    'Black': '#68c582',      // Soft Green
    'Hispanic': '#f0ba5e',   // Muted Orange
    'White': '#4674ea',      // Bright Blue
    'Other': '#b1b1b1'       // Grey
  };

  const AGE_LABELS = ['0-4', '5-17', '18-34', '35-59', '60+'];

  const R = 18;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  let donutSegments = [];
  let indicatorData = [];
  let ethSegments = [];
  let waffleDots = []; // For the Dot Matrix
  let maxAgeVal = 0; // For bar chart scaling

  // --- REACTIVE CALCULATIONS ---
  $: {
    if ($activeLayer === 'landuse') {
        let accumulatedPercent = 0;
        const data = $analysisData;
        const rawSegments = LU_CATEGORIES.map(cat => {
            const key = cat.code; 
            const altKey = parseInt(cat.code).toString();
            const categoryAcres = data.breakdown ? (data.breakdown[key] || data.breakdown[altKey] || 0) : 0;
            const pct = (data.area > 0) ? (categoryAcres / data.area) : 0;
            return { ...cat, pct, categoryAcres };
        });

        donutSegments = rawSegments.map(seg => {
            const segmentLength = seg.pct * CIRCUMFERENCE;
            const rotation = (accumulatedPercent * 360) - 90;
            accumulatedPercent += seg.pct;
            return {
                ...seg,
                dashArray: `${segmentLength} ${CIRCUMFERENCE}`, 
                rotation: rotation,
                displayPct: (seg.pct * 100).toFixed(1), 
                displayAcres: seg.categoryAcres.toFixed(1)
            };
        });
        
        // Restore Indicators
        const targetCodes = ['9', '11'];
        indicatorData = rawSegments
            .filter(seg => targetCodes.includes(seg.code))
            .map(seg => {
                const segmentLength = seg.pct * CIRCUMFERENCE;
                return {
                    label: seg.label, 
                    color: seg.color,
                    displayPct: (seg.pct * 100).toFixed(1), 
                    dashArray: `${segmentLength} ${CIRCUMFERENCE}`
                };
            });

    } else {
        // --- DEMOGRAPHICS CALCULATIONS ---
        const dData = $demographicsData;
        const total = dData.totalPeople || 1; 

        // 1. Prepare Segments for List
        const entries = Object.keys(dData.ethnicityBreakdown || {}).length > 0 
            ? Object.entries(dData.ethnicityBreakdown)
            : [['No Data', 0]];
        entries.sort((a, b) => b[1] - a[1]); 

        ethSegments = entries.map(([label, count]) => {
            const pct = count / total;
            return {
                label, 
                count,
                color: ETH_COLORS[label] || ETH_COLORS[label.charAt(0).toUpperCase() + label.slice(1)] || '#ccc',
                displayPct: (pct * 100).toFixed(1)
            };
        });

        // 2. Generate Dot Matrix (10x10 Waffle Chart)
        // We map the 100 dots to the proportions
        waffleDots = [];
        let currentDotCount = 0;
        
        ethSegments.forEach(seg => {
            // Calculate how many dots (out of 100) this group gets
            const numDots = Math.round(parseFloat(seg.displayPct)); 
            for (let i = 0; i < numDots; i++) {
                if (waffleDots.length < 100) {
                   waffleDots.push({ color: seg.color });
                }
            }
        });
        // Fill remaining dots with grey if rounding left gaps
        while (waffleDots.length < 100) {
            waffleDots.push({ color: '#eee' }); 
        }

        // 3. Age Chart Scaling
        const ageVals = Object.values(dData.ageBreakdown || {});
        maxAgeVal = Math.max(...ageVals, 1); // Avoid div by zero
    }
  }
</script>

<div class="sidebar">
  <div class="layer-tabs">
    <button class:active={$activeLayer === 'landuse'} on:click={() => activeLayer.set('landuse')}>Land Use</button>
    <button class:active={$activeLayer === 'demographics'} on:click={() => activeLayer.set('demographics')}>Demographics</button>
  </div>

  <div class="header">
    <h1>{$activeLayer === 'landuse' ? 'Land Use' : 'Demographics'}</h1>
    <div class="control-group">
        <label for="radius">Pedshed Radius: <strong>{$radius} mi</strong></label>
        <input id="radius" type="range" min="0.1" max="1.0" step="0.05" bind:value={$radius} />
    </div>
  </div>

  {#if $activeLayer === 'landuse'}
    <div class="metrics-grid">
        <div class="metric">
            <span class="value">{$analysisData.count.toLocaleString()}</span>
            <span class="label">Lots</span>
        </div>
        <div class="metric">
            <span class="value">{$analysisData.area ? $analysisData.area.toFixed(1) : '0.0'} <small>ac</small></span>
            <span class="label">Lot Area</span>
        </div>
        <div class="metric entropy-metric">
            <div class="donut-wrapper">
                <svg width="50" height="50" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
                    {#each donutSegments as seg}
                        <circle cx="20" cy="20" r={R} fill="none" stroke={seg.color} stroke-width="4"
                            stroke-dasharray={seg.dashArray} transform="rotate({seg.rotation} 20 20)" />
                    {/each}
                </svg>
                <span class="value centered">{$analysisData.entropy ? $analysisData.entropy.toFixed(2) : '0.00'}</span>
            </div>
            <span class="label">Entropy Score</span>
        </div>
    </div>
    <div class="category-list">
        <h3>Land Use Categories</h3>
        {#each donutSegments as cat} 
          <div class="category-row">
            <div class="cat-info">
              <span class="cat-name">{cat.label}</span>
              <span class="cat-val">{cat.displayPct}%</span>
            </div>
            <div class="progress-bar-bg">
               <div class="progress-bar-fill" style:width="{cat.displayPct}%" style:background-color={cat.color}></div>
            </div>
          </div>
        {/each}
    </div>
    <div class="indicators-section">
        <h3>Key Indicators</h3>
        <div class="indicator-grid">
          {#each indicatorData as ind}
            <div class="indicator-card">
              <div class="donut-mini">
                <svg width="60" height="60" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
                  <circle cx="20" cy="20" r={R} fill="none" stroke={ind.color} stroke-width="4"
                    stroke-dasharray={ind.dashArray} transform="rotate(-90 20 20)" />
                  <text x="50%" y="55%" text-anchor="middle" font-size="8" font-weight="bold" fill="#333">{ind.displayPct}%</text>
                </svg>
              </div>
              <span class="label">{ind.label}</span>
            </div>
          {/each}
        </div>
    </div>

  {:else}
    <div class="metrics-grid">
        <div class="metric">
            <span class="value">{$demographicsData.totalPeople.toLocaleString()}</span>
            <span class="label">People</span>
        </div>
        <div class="metric">
            <span class="value">{$demographicsData.density.toFixed(1)}</span>
            <span class="label">People / Acre</span>
        </div>
    </div>

    <div class="section-container">
        <h3>Race / Ethnicity</h3>
        
        <div class="race-layout">
            <div class="waffle-chart">
                {#each waffleDots as dot}
                    <div class="waffle-dot" style:background-color={dot.color}></div>
                {/each}
            </div>

            <div class="race-list">
                {#each ethSegments as cat} 
                  <div class="race-row">
                    <span class="race-dot" style:background-color={cat.color}></span>
                    <span class="race-name">{cat.label}</span>
                    <span class="race-val">{cat.displayPct}%</span>
                  </div>
                {/each}
            </div>
        </div>
    </div>

    <div class="section-container">
        <h3>Age Distribution</h3>
        <div class="age-chart">
            {#each AGE_LABELS as label}
                {@const count = $demographicsData.ageBreakdown[label] || 0}
                {@const heightPct = maxAgeVal > 0 ? (count / maxAgeVal) * 100 : 0}
                <div class="age-col">
                    <div class="bar-container">
                        <div class="bar-fill" style:height="{heightPct}%"></div>
                    </div>
                    <span class="age-label">{label}</span>
                    <span class="age-val">{count}</span>
                </div>
            {/each}
        </div>
    </div>

    <div class="indicators-section">
        <div class="indicator-grid">
            <div class="indicator-card">
                 <div class="donut-mini">
                    <svg width="60" height="60" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
                      <circle cx="20" cy="20" r={R} fill="none" stroke="#333" stroke-width="4"
                        stroke-dasharray="{($demographicsData.percentFemale / 100) * CIRCUMFERENCE} {CIRCUMFERENCE}" 
                        transform="rotate(-90 20 20)" />
                      <text x="50%" y="55%" text-anchor="middle" font-size="8" font-weight="bold" fill="#333">
                        {$demographicsData.percentFemale.toFixed(1)}%
                      </text>
                    </svg>
                  </div>
                  <span class="label">Percent Female</span>
            </div>
            
            <div class="indicator-card">
                 <div class="donut-mini">
                    <svg width="60" height="60" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
                      <circle cx="20" cy="20" r={R} fill="none" stroke="#4674ea" stroke-width="4"
                        stroke-dasharray="{$demographicsData.diversityIndex * CIRCUMFERENCE} {CIRCUMFERENCE}" 
                        transform="rotate(-90 20 20)" />
                      <text x="50%" y="55%" text-anchor="middle" font-size="8" font-weight="bold" fill="#333">
                        {$demographicsData.diversityIndex.toFixed(2)}
                      </text>
                    </svg>
                  </div>
                  <span class="label">Diversity Index</span>
            </div>
        </div>
    </div>

  {/if}
</div>

<style>
  /* GLOBAL LAYOUT */
  .sidebar { padding: 2rem; font-family: 'Inter', sans-serif; color: #333; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .control-group { margin-bottom: 2rem; padding: 1rem; background: #f9f9f9; border-radius: 4px; }
  label { display: block; font-size: 0.85rem; margin-bottom: 0.5rem; color: #555; }
  input[type=range] { width: 100%; cursor: pointer; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 700; }
  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 1rem; margin-top: 2rem; }
  
  /* TABS */
  .layer-tabs { display: flex; border-bottom: 1px solid #eee; margin-bottom: 1.5rem; }
  .layer-tabs button { flex: 1; padding: 0.75rem; border: none; background: none; cursor: pointer; font-weight: 600; color: #888; border-bottom: 2px solid transparent; }
  .layer-tabs button.active { color: #333; border-bottom-color: #333; }

  /* METRICS GRID */
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; padding-bottom: 2rem; border-bottom: 1px solid #eee; }
  .metric { display: flex; flex-direction: column; justify-content: flex-start; }
  .entropy-metric { align-items: center; }
  .donut-wrapper { position: relative; width: 50px; height: 50px; display: flex; justify-content: center; align-items: center; margin-bottom: 0.25rem; }
  .donut-wrapper svg { position: absolute; top: 0; left: 0; }
  circle { transition: all 0.3s ease; } 
  .value { font-size: 1.5rem; font-weight: 700; color: #111; line-height: 1.2; }
  .value.centered { font-size: 0.9rem; } 
  .value small { font-size: 1rem; color: #666; font-weight: 400; }
  .label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 0.25rem; text-align: center;}
  
  /* CATEGORY LIST (LAND USE) */
  .category-row { margin-bottom: 1rem; }
  .cat-info { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem; }
  .progress-bar-bg { width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; }
  .progress-bar-fill { height: 100%; transition: width 0.3s ease; }

  /* --- NEW DEMOGRAPHICS STYLES --- */
  
  /* DOT MATRIX (WAFFLE) */
  .race-layout { display: flex; gap: 1.5rem; align-items: flex-start; }
  .waffle-chart {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: 3px;
      width: 100px; /* Fixed width for the grid */
  }
  .waffle-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #eee;
  }
  .race-list { flex: 1; }
  .race-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 0.8rem; }
  .race-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
  .race-name { flex: 1; color: #555; }
  .race-val { font-weight: 600; color: #333; }

  /* AGE CHART */
  .age-chart { display: flex; justify-content: space-between; height: 120px; align-items: flex-end; gap: 8px; }
  .age-col { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
  .bar-container { width: 100%; flex: 1; display: flex; align-items: flex-end; background: rgba(0,0,0,0.03); border-radius: 2px; overflow: hidden; }
  .bar-fill { width: 100%; background: #444; transition: height 0.3s ease; }
  .age-label { font-size: 0.7rem; color: #888; margin-top: 6px; }
  .age-val { font-size: 0.7rem; font-weight: 600; color: #333; margin-top: 2px; }

  /* INDICATORS */
  .indicators-section { margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #eee; }
  .indicator-grid { display: flex; gap: 2rem; justify-content: flex-start; }
  .indicator-card { display: flex; flex-direction: column; align-items: center; width: 80px; text-align: center; }
  .donut-mini { margin-bottom: 0.5rem; }
</style>