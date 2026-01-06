<script>
  export let data = []; // Array of { pct: 0.1, color: 'red' }
  export let label = ''; 
  export let size = 50;

  const R = 18;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  $: segments = (() => {
      let accumulated = 0;
      return data.map(d => {
          const len = d.pct * CIRCUMFERENCE;
          const rot = (accumulated * 360) - 90;
          accumulated += d.pct;
          return { ...d, dash: `${len} ${CIRCUMFERENCE}`, rot };
      });
  })();
</script>

<div class="donut" style:width="{size}px" style:height="{size}px">
    <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={R} fill="none" stroke="#eee" stroke-width="4" />
        {#each segments as seg}
            <circle cx="20" cy="20" r={R} fill="none" stroke={seg.color} 
                    stroke-width="4" stroke-dasharray={seg.dash} 
                    transform="rotate({seg.rot} 20 20)" />
        {/each}
        {#if label}
            <text x="50%" y="55%" text-anchor="middle" font-size="10" font-weight="bold" fill="#333">{label}</text>
        {/if}
    </svg>
</div>

<style>
    .donut { position: relative; }
    circle { transition: all 0.5s ease-out; }
</style>