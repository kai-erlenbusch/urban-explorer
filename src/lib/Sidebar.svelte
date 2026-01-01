<script>
  export let data = {
    count: 0,
    area: 0,
    breakdown: {}
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

  function getPercentage(code) {
    if (data.count === 0) return 0;
    const count = data.breakdown[code] || 0;
    return (count / data.count) * 100;
  }
</script>

<div class="sidebar">
  <div class="header">
    <h1>Land Use</h1>
    <p class="description">Land use data reveals the general distribution...</p>
  </div>

  <div class="metrics-grid">
    <div class="metric">
      <span class="value">{data.count}</span>
      <span class="label">Lots</span>
    </div>
    <div class="metric">
      <span class="value">{data.area.toFixed(2)} <small>ac</small></span>
      <span class="label">Lot Area</span>
    </div>
    <div class="metric">
      <span class="value">0.64</span>
      <span class="label">Entropy Score</span>
    </div>
  </div>

  <div class="category-list">
    <h3>Land Use Categories</h3>
    {#each CATEGORIES as cat}
      <div class="category-row">
        <div class="cat-info">
          <span class="cat-name">{cat.label}</span>
          <span class="cat-val">{getPercentage(cat.code).toFixed(1)}%</span>
        </div>
        <div class="progress-bar-bg">
          <div 
            class="progress-bar-fill" 
            style="width: {getPercentage(cat.code)}%; background-color: {cat.color};"
          ></div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .sidebar { padding: 2rem; font-family: 'Inter', sans-serif; color: #333; height: 100%; overflow-y: auto; box-sizing: border-box; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 700; }
  .description { font-size: 0.9rem; line-height: 1.5; color: #666; margin-bottom: 2rem; }
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2.5rem; padding-bottom: 2rem; border-bottom: 1px solid #eee; }
  .metric { display: flex; flex-direction: column; }
  .value { font-size: 1.8rem; font-weight: 700; color: #111; }
  .value small { font-size: 1rem; color: #666; font-weight: 400; }
  .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 0.25rem; }
  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 1rem; }
  .category-row { margin-bottom: 1rem; }
  .cat-info { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem; }
  .progress-bar-bg { width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; }
  .progress-bar-fill { height: 100%; transition: width 0.2s ease; }
</style>