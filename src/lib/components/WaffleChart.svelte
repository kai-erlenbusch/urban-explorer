<script>
    export let breakdown = {}; // { 'Asian': 0.5, ... }
    export let colors = {};

    let dots = [];
    $: {
        dots = [];
        Object.entries(breakdown).sort((a,b) => b[1] - a[1]).forEach(([key, pct]) => {
            const count = Math.round(pct * 100);
            for(let i=0; i<count; i++) dots.push(colors[key] || '#ccc');
        });
        while(dots.length < 100) dots.push('#eee');
        dots = dots.slice(0, 100);
    }
</script>

<div class="waffle">
    {#each dots as color}
        <div class="dot" style:background-color={color}></div>
    {/each}
</div>

<style>
    .waffle { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; width: 100px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; }
</style>