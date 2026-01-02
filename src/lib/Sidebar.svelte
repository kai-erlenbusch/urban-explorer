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

  const ETH_COLORS = {
    'Asian': '#E55E5E',
    'Black': '#3182CE',
    'Hispanic': '#DD6B20',
    'White': '#38A169',
    'Other': '#718096'
  };

  const R = 18;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  let donutSegments = [];
  let indicatorData = [];
  let ethSegments = [];

  // --- REACTIVE CALCULATIONS ---
  $: {
    if ($activeLayer === 'landuse') {
        // 1. LAND USE CALCULATIONS
        let accumulatedPercent = 0;
        const data = $analysisData;
        
        // Calculate breakdown for Main Donut & List
        const rawSegments = LU_CATEGORIES.map(cat => {
            // Handle both string keys ('01') and int keys (1) just in case
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

        // 2. KEY INDICATORS (RESTORED PARKS & VACANT)
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
        // 3. DEMOGRAPHICS CALCULATIONS
        const dData = $demographicsData;
        let accumulatedPercent = 0;
        const total = dData.totalPeople || 1; 

        const entries = Object.entries(dData.ethnicityBreakdown || {});
        entries.sort((a, b) => b[1] - a[1]); // Sort descending

        ethSegments = entries.map(([label, count]) => {
            const pct = count / total;
            const segmentLength = pct * CIRCUMFERENCE;
            const rotation = (accumulatedPercent * 360) - 90;
            accumulatedPercent += pct;
            
            return {
                label, 
                count,
                color: ETH_COLORS[label] || '#ccc',
                displayPct: (pct * 100).toFixed(1),
                dashArray: `${segmentLength} ${CIRCUMFERENCE}`, 
                rotation
            };
        });
    }
  }
</script>

<div class="sidebar">
  <div class="layer-tabs">
    <button 
        class:active={$activeLayer === 'landuse'} 
        on:click={() => activeLayer.set('landuse')}>
        Land Use
    </button>
    <button 
        class:active={$activeLayer === 'demographics'} 
        on:click={() => activeLayer.set('demographics')}>
        Demographics
    </button>
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
                  <text x="50%" y="55%" text-anchor="middle" font-size="8" font-weight="bold" fill="#333">
                    {ind.displayPct}%
                  </text>
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

    <div class="category-list">
        <h3>Race / Ethnicity</h3>
        
        <div class="donut-container" style="display:flex; justify-content:center; margin-bottom:2rem;">
             <svg width="120" height="120" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
                {#each ethSegments as seg}
                    <circle cx="20" cy="20" r={R} fill="none" stroke={seg.color} stroke-width="4"
                        stroke-dasharray={seg.dashArray} transform="rotate({seg.rotation} 20 20)" />
                {/each}
            </svg>
        </div>

        {#each ethSegments as cat} 
          <div class="category-row">
            <div class="cat-info">
              <span class="cat-name" style="color:{cat.color}; font-weight:bold;">● {cat.label}</span>
              <span class="cat-val">{cat.displayPct}% ({cat.count.toLocaleString()})</span>
            </div>
          </div>
        {/each}
    </div>
  {/if}
</div>

<style>
  /* TABS */
  .layer-tabs { display: flex; border-bottom: 1px solid #eee; margin-bottom: 1.5rem; }
  .layer-tabs button {
    flex: 1; padding: 0.75rem; border: none; background: none; cursor: pointer;
    font-weight: 600; color: #888; border-bottom: 2px solid transparent;
  }
  .layer-tabs button.active { color: #333; border-bottom-color: #333; }
  
  /* CONTROLS */
  .control-group { margin-bottom: 2rem; padding: 1rem; background: #f9f9f9; border-radius: 4px; }
  label { display: block; font-size: 0.85rem; margin-bottom: 0.5rem; color: #555; }
  input[type=range] { width: 100%; cursor: pointer; }

  /* SIDEBAR LAYOUT */
  .sidebar { padding: 2rem; font-family: 'Inter', sans-serif; color: #333; height: 100%; overflow-y: auto; box-sizing: border-box; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 700; }
  
  /* METRICS */
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 2.5rem; padding-bottom: 2rem; border-bottom: 1px solid #eee; }
  .metric { display: flex; flex-direction: column; justify-content: flex-start; }
  .entropy-metric { align-items: center; }
  .donut-wrapper { position: relative; width: 50px; height: 50px; display: flex; justify-content: center; align-items: center; margin-bottom: 0.25rem; }
  .donut-wrapper svg { position: absolute; top: 0; left: 0; }
  circle { transition: all 0.3s ease; } 

  .value { font-size: 1.5rem; font-weight: 700; color: #111; line-height: 1.2; }
  .value.centered { font-size: 0.9rem; } 
  .value small { font-size: 1rem; color: #666; font-weight: 400; }
  .label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 0.25rem; text-align: center;}
  
  /* CATEGORIES */
  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 1rem; }
  .category-row { margin-bottom: 1rem; }
  .cat-info { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem; }
  .progress-bar-bg { width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; }
  .progress-bar-fill { height: 100%; transition: width 0.3s ease; }

  /* INDICATORS (RESTORED) */
  .indicators-section { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee; }
  .indicator-grid { display: flex; gap: 2rem; justify-content: flex-start; }
  .indicator-card { display: flex; flex-direction: column; align-items: center; width: 80px; text-align: center; }
  .donut-mini { margin-bottom: 0.5rem; }
</style>