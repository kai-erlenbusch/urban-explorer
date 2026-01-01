<script>
  export let radius = 0.25; 
  export let data = {
    count: 0,
    area: 0,
    breakdown: {},
    entropy: 0
  };

  const CATEGORIES = [
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

  // --- DONUT CHART CONSTANTS ---
  const R = 18;
  const CIRCUMFERENCE = 2 * Math.PI * R; // ~113.097

  let donutSegments = [];
  let indicatorData = [];

  $: {
    let accumulatedPercent = 0;
    
    // 1. Calculate stats for ALL categories
    const rawSegments = CATEGORIES.map(cat => {
      const categoryAcres = data.breakdown ? (data.breakdown[cat.code] || data.breakdown[parseInt(cat.code)] || 0) : 0;
      const pct = (data.area > 0) ? (categoryAcres / data.area) : 0;
      return { ...cat, pct, categoryAcres };
    });

    // 2. Main "Entropy" Donut (Stacked)
    donutSegments = rawSegments.map(seg => {
      const segmentLength = seg.pct * CIRCUMFERENCE;
      const rotation = (accumulatedPercent * 360) - 90;
      accumulatedPercent += seg.pct;

      return {
        code: seg.code, 
        label: seg.label,
        color: seg.color,
        dashArray: `${segmentLength} ${CIRCUMFERENCE}`,
        rotation: rotation,
        displayPct: (seg.pct * 100).toFixed(1),
        displayAcres: seg.categoryAcres.toFixed(1)
      };
    });

    // 3. NEW: "Key Indicators" Donuts (Standalone)
    // We strictly filter for Parks (9) and Vacant (11)
    const targetCodes = ['9', '11'];
    
    indicatorData = rawSegments
      .filter(seg => targetCodes.includes(seg.code))
      .map(seg => {
        // Calculate a standalone stroke for this category starting at 12 o'clock
        const segmentLength = seg.pct * CIRCUMFERENCE;
        return {
          label: seg.label,
          color: seg.color,
          displayPct: (seg.pct * 100).toFixed(1),
          dashArray: `${segmentLength} ${CIRCUMFERENCE}`
        };
      });
  }
</script>

<div class="sidebar">
  <div class="header">
    <h1>Land Use</h1>
    <p class="description">Land use data reveals the general distribution of existing functions.</p>
    
    <div class="control-group">
        <label for="radius">Pedshed Radius: <strong>{radius} mi</strong></label>
        <input 
            id="radius" 
            type="range" 
            min="0.1" 
            max="1.0" 
            step="0.05" 
            bind:value={radius} 
        />
    </div>
  </div>

  <div class="metrics-grid">
    <div class="metric">
      <span class="value">{data.count.toLocaleString()}</span>
      <span class="label">Lots</span>
    </div>
    <div class="metric">
      <span class="value">{data.area ? data.area.toFixed(1) : '0.0'} <small>ac</small></span>
      <span class="label">Lot Area</span>
    </div>
    
    <div class="metric entropy-metric">
      <div class="donut-wrapper">
        <svg width="50" height="50" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
          {#each donutSegments as seg}
            <circle 
              cx="20" cy="20" r={R} 
              fill="none" 
              stroke={seg.color} 
              stroke-width="4"
              stroke-dasharray={seg.dashArray}
              transform="rotate({seg.rotation} 20 20)" 
            />
          {/each}
        </svg>
        <span class="value centered">{data.entropy ? data.entropy.toFixed(2) : '0.00'}</span>
      </div>
      <span class="label">Entropy Score</span>
    </div>
  </div>

  <div class="category-list">
    <h3>Land Use Categories</h3>
    {#each donutSegments as cat (cat.code)} 
      <div class="category-row">
        <div class="cat-info">
          <span class="cat-name">{cat.label}</span>
          <span class="cat-val">
            {cat.displayPct}% <small style="color:#aaa;">({cat.displayAcres} ac)</small>
          </span>
        </div>
        <div class="progress-bar-bg">
          <div 
            class="progress-bar-fill" 
            style:width="{cat.displayPct}%" 
            style:background-color={cat.color}
          ></div>
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
              <circle 
                cx="20" cy="20" r={R} 
                fill="none" 
                stroke={ind.color} 
                stroke-width="4"
                stroke-dasharray={ind.dashArray}
                transform="rotate(-90 20 20)" 
              />
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

</div>

<style>
  .control-group { margin-bottom: 2rem; padding: 1rem; background: #f9f9f9; border-radius: 4px; }
  label { display: block; font-size: 0.85rem; margin-bottom: 0.5rem; color: #555; }
  input[type=range] { width: 100%; cursor: pointer; }

  .sidebar { padding: 2rem; font-family: 'Inter', sans-serif; color: #333; height: 100%; overflow-y: auto; box-sizing: border-box; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 700; }
  .description { font-size: 0.9rem; line-height: 1.5; color: #666; margin-bottom: 2rem; }
  
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
  
  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 1rem; }
  .category-row { margin-bottom: 1rem; }
  .cat-info { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem; }
  .progress-bar-bg { width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; }
  .progress-bar-fill { height: 100%; transition: width 0.3s ease; }

  /* NEW STYLES FOR INDICATORS */
  .indicators-section { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee; }
  .indicator-grid { display: flex; gap: 2rem; justify-content: flex-start; }
  .indicator-card { display: flex; flex-direction: column; align-items: center; width: 80px; text-align: center; }
  .donut-mini { margin-bottom: 0.5rem; }
</style>