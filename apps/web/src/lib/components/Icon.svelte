<script lang="ts">
  import { ICONS } from "$lib/editor/icons";

  /** A Lucide icon from the shared shape data (`editor/icons.ts`), for places that list them by name. */
  let { name, size = 16 }: { name: keyof typeof ICONS; size?: number } = $props();
  const data = $derived(ICONS[name]);
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each data.node as [tag, attrs], i (i)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>
