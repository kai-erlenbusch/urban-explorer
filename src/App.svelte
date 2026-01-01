<script>
  import Map from './lib/Map.svelte';
  import Sidebar from './lib/Sidebar.svelte';

  let analysisData = {
    count: 0,
    area: 0,
    breakdown: {}
  };

  function handleAnalysis(event) {
    analysisData = event.detail;
  }
</script>

<main>
  <div class="sidebar-container">
    <Sidebar data={analysisData} />
  </div>
  <div class="map-container">
    <Map on:analysis={handleAnalysis} />
  </div>
</main>

<style>
  main {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
  .sidebar-container {
    width: 350px;
    flex-shrink: 0;
    border-right: 1px solid #ddd;
    background: white;
    z-index: 10;
  }
  .map-container {
    flex-grow: 1;
    position: relative;
  }
</style>