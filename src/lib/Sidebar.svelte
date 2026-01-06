<script>
  import { onMount } from 'svelte';
  import { activeLayer, analysisData, demographicsData, transitData, radius } from './stores.js';
  import { LU_CATEGORIES, ETH_COLORS, SUBWAY_COLORS, AGE_LABELS } from './constants.js';
  
  import DonutChart from './components/DonutChart.svelte';
  import WaffleChart from './components/WaffleChart.svelte';

  let sectionRefs = {}; 

  // Scroll Spy Logic
  onMount(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) activeLayer.set(entry.target.id);
      });
    }, { rootMargin: '-40% 0px -40% 0px' });

    ['landuse', 'demographics', 'transit'].forEach(id => {
        if (sectionRefs[id]) observer.observe(sectionRefs[id]);
    });
    return () => observer.disconnect();
  });

  // --- DERIVED DATA ---
  
  // 1. Land Use
  $: totalArea = $analysisData.area || 1;
  $: luSegments = LU_CATEGORIES.map(cat => {
      const area = ($analysisData.breakdown?.[cat.code] || 0);
      return { ...cat, pct: area / totalArea, area };
  });

  // 2. Demographics
  $: ethBreakdown = (() => {
      const total = $demographicsData.totalPeople || 1;
      const bd = $demographicsData.ethnicityBreakdown || {};
      let res = {};
      Object.entries(bd).forEach(([k, v]) => res[k] = v / total);
      return res;
  })();
  
  $: maxAgeVal = Math.max(...Object.values($demographicsData.ageBreakdown), 1);

  // Data for Indicator Donuts (Diversity & Female)
  $: femaleData = [{ pct: $demographicsData.percentFemale / 100, color: '#333' }];
  $: diversityData = [{ pct: $demographicsData.diversityIndex, color: '#4674ea' }];

</script>

<div class="sidebar">
  <div class="header-container">
      <div class="header-content">
        <h1>{#if $activeLayer === 'landuse'}Land Use{:else if $activeLayer === 'demographics'}Demographics{:else}Transit Network{/if}</h1>
        <div class="control-group">
            <label for="radius">Pedshed Radius: <strong>{$radius} mi</strong></label>
            <input id="radius" type="range" min="0.1" max="1.0" step="0.05" bind:value={$radius} />
        </div>
      </div>
  </div>

  <div class="scroll-content">
      <section id="landuse" bind:this={sectionRefs['landuse']}>
        <div class="section-label">01. Land Use</div>
        <div class="metrics-grid">
            <div class="metric"><span class="value">{$analysisData.count.toLocaleString()}</span><span class="label">Lots</span></div>
            <div class="metric"><span class="value">{$analysisData.area?.toFixed(1) || '0.0'} <small>ac</small></span><span class="label">Lot Area</span></div>
            <div class="metric entropy-metric">
                <div class="donut-wrapper">
                    <DonutChart data={luSegments} label={$analysisData.entropy?.toFixed(2) || '0.00'} size={50} />
                </div>
                <span class="label">Entropy Score</span>
            </div>
        </div>
        
        <div class="category-list">
            <h3>Categories</h3>
            {#each luSegments as cat}
                <div class="category-row">
                    <div class="cat-info">
                        <span class="cat-name">{cat.label}</span>
                        <span class="cat-val">{(cat.pct * 100).toFixed(1)}%</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" 
                             style:width="{cat.pct * 100}%" 
                             style:background-color={cat.color}>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
      </section>

      <hr class="section-divider" />

      <section id="demographics" bind:this={sectionRefs['demographics']}>
        <div class="section-label">02. Demographics</div>
        <div class="metrics-grid">
            <div class="metric"><span class="value">{$demographicsData.totalPeople.toLocaleString()}</span><span class="label">People</span></div>
            <div class="metric"><span class="value">{$demographicsData.density.toFixed(1)}</span><span class="label">People / Acre</span></div>
        </div>

        <div class="section-container">
            <h3>Race / Ethnicity</h3>
            <div class="race-layout">
                <WaffleChart breakdown={ethBreakdown} colors={ETH_COLORS} />
                <div class="race-list">
                    {#each Object.entries(ethBreakdown).sort((a,b) => b[1]-a[1]) as [label, pct]}
                        <div class="race-row">
                            <span class="race-dot" style:background-color={ETH_COLORS[label]}></span>
                            <span class="race-name">{label}</span>
                            <span class="race-val">{(pct * 100).toFixed(1)}%</span>
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
                         <DonutChart data={femaleData} label={`${$demographicsData.percentFemale.toFixed(1)}%`} size={60} />
                    </div>
                    <span class="label">Percent Female</span>
                </div>
                <div class="indicator-card">
                    <div class="donut-mini">
                        <DonutChart data={diversityData} label={$demographicsData.diversityIndex.toFixed(2)} size={60} />
                    </div>
                    <span class="label">Diversity Index</span>
                </div>
            </div>
        </div>
      </section>

      <hr class="section-divider" />

      <section id="transit" bind:this={sectionRefs['transit']}>
        <div class="section-label">03. Transit Network</div>
        
        <div class="transit-groups">
            <div class="transit-group">
                <div class="group-header">
                    <span class="indicator-dot subway"></span>
                    <h4>Subway Network</h4>
                </div>
                <div class="pill-container">
                    {#if $transitData.subwayLines.length === 0}
                        <span class="empty-state">No lines nearby</span>
                    {:else}
                        {#each $transitData.subwayLines as line}
                            {@const bg = SUBWAY_COLORS[line] || '#333'}
                            {@const isYellow = ['N','Q','R','W'].includes(line)}
                            <span class="line-pill" 
                                  style:background-color={bg} 
                                  style:color={isYellow ? '#000' : '#fff'}>
                                {line}
                            </span>
                        {/each}
                    {/if}
                </div>
                <div class="metric-row">
                    <span class="label">Stations within radius</span>
                    <span class="value-small">{$transitData.subwayStationCount}</span>
                </div>
            </div>

            <div class="transit-group">
                <div class="group-header">
                    <span class="indicator-dot rail"></span>
                    <h4>Railroads</h4>
                </div>
                <div class="pill-container">
                     {#if $transitData.railLines.length === 0}
                        <span class="empty-state">No rail nearby</span>
                    {:else}
                        {#each $transitData.railLines as line}
                            <span class="rail-pill active">{line}</span>
                        {/each}
                    {/if}
                </div>
                 <div class="metric-row">
                    <span class="label">Stations within radius</span>
                    <span class="value-small">{$transitData.railStationCount}</span>
                </div>
            </div>

            <div class="transit-group">
                <div class="group-header">
                    <span class="indicator-dot bus"></span>
                    <h4>Bus Network</h4>
                </div>
                <div class="pill-container">
                    {#if $transitData.busLines.length === 0}
                        <span class="empty-state">No bus stops nearby</span>
                    {:else}
                        {#each $transitData.busLines.slice(0, 20) as line}
                            <span class="bus-pill">{line}</span>
                        {/each}
                        {#if $transitData.busLines.length > 20}
                            <span class="bus-pill">+{ $transitData.busLines.length - 20 }</span>
                        {/if}
                    {/if}
                </div>
                 <div class="metric-row">
                    <span class="label">Stops within radius</span>
                    <span class="value-small">{$transitData.busStopCount}</span>
                </div>
            </div>
        </div>
      </section>

      <div style="height: 200px;"></div>
  </div>
</div>

<style>
  /* Base styles */
  .sidebar { height: 100%; display: flex; flex-direction: column; font-family: 'Inter', sans-serif; color: #333; overflow: hidden; }
  .header-container { background: white; padding: 2rem 2rem 1rem 2rem; border-bottom: 1px solid #eee; box-shadow: 0 4px 6px -4px rgba(0,0,0,0.05); z-index: 20; }
  .control-group { margin-top: 1rem; padding: 1rem; background: #f9f9f9; border-radius: 4px; }
  label { display: block; font-size: 0.85rem; margin-bottom: 0.5rem; color: #555; }
  input[type=range] { width: 100%; cursor: pointer; }
  h1 { font-size: 1.5rem; margin: 0; font-weight: 700; transition: color 0.3s; }
  
  .scroll-content { flex: 1; overflow-y: auto; padding: 2rem; scroll-behavior: smooth; }
  section { min-height: 80vh; padding-bottom: 4rem; }
  .section-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #aaa; margin-bottom: 2rem; font-weight: 700; }
  .section-divider { border: 0; border-top: 1px dashed #ddd; margin: 4rem 0; }
  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 1rem; margin-top: 2rem; }
  
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; padding-bottom: 2rem; border-bottom: 1px solid #eee; }
  .metric { display: flex; flex-direction: column; justify-content: flex-start; }
  .entropy-metric { align-items: center; }
  .donut-wrapper { position: relative; display: flex; justify-content: center; align-items: center; margin-bottom: 0.25rem; }
  
  .value { font-size: 1.5rem; font-weight: 700; color: #111; line-height: 1.2; }
  .value small { font-size: 1rem; color: #666; font-weight: 400; }
  .label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 0.25rem; text-align: center;}
  
  .category-row { margin-bottom: 1rem; }
  .cat-info { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem; }
  .progress-bar-bg { width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; }
  .progress-bar-fill { height: 100%; transition: width 0.3s ease; }
  
  .race-layout { display: flex; gap: 1.5rem; align-items: flex-start; }
  .race-list { flex: 1; }
  .race-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 0.8rem; }
  .race-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
  .race-name { flex: 1; color: #555; }
  .race-val { font-weight: 600; color: #333; }
  
  .age-chart { display: flex; justify-content: space-between; height: 120px; align-items: flex-end; gap: 8px; }
  .age-col { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
  .bar-container { width: 100%; flex: 1; display: flex; align-items: flex-end; background: rgba(0,0,0,0.03); border-radius: 2px; overflow: hidden; }
  .bar-fill { width: 100%; background: #444; transition: height 0.3s ease; }
  .age-label { font-size: 0.7rem; color: #888; margin-top: 6px; }
  .age-val { font-size: 0.7rem; font-weight: 600; color: #333; margin-top: 2px; }
  
  .indicators-section { margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #eee; }
  .indicator-grid { display: flex; gap: 2rem; justify-content: flex-start; }
  .indicator-card { display: flex; flex-direction: column; align-items: center; width: 80px; text-align: center; }
  .donut-mini { margin-bottom: 0.5rem; }
  
  /* TRANSIT RESTORED */
  .transit-group { margin-bottom: 3rem; }
  .group-header { display: flex; align-items: center; margin-bottom: 1rem; }
  .indicator-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; }
  .indicator-dot.subway { background-color: #ffd73e; } 
  .indicator-dot.rail { background-color: #ff98ab; }   
  .indicator-dot.bus { background-color: #0245ef; }    
  h4 { margin: 0; font-size: 1rem; font-weight: 600; }
  .pill-container { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 1rem; min-height: 1.5rem; }
  
  .line-pill { 
      width: 24px; height: 24px; border-radius: 50%; 
      display: flex; align-items: center; justify-content: center; 
      font-size: 0.7rem; font-weight: bold; 
  }
  
  .rail-pill, .bus-pill {
      padding: 4px 8px; border-radius: 4px;
      font-size: 0.75rem; font-weight: 600;
      background: #333; color: white;
  }
  
  .metric-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; border-top: 1px solid #eee; padding-top: 0.5rem; }
  .value-small { font-weight: 700; font-size: 1rem; }
  .empty-state { font-size: 0.75rem; color: #999; font-style: italic; }
</style>