<script lang="ts">
  import { onMount } from "svelte";
  import { getLlmStatus, getUsage } from "$lib/api";
  import { visiblePoll } from "$lib/poll";
  import { bannerFor, type Banner } from "$lib/settings-form";

  let banner = $state<Banner | null>(null);

  async function refresh(): Promise<void> {
    try {
      const [llm, usage] = await Promise.all([getLlmStatus(), getUsage()]);
      banner = bannerFor(llm, usage);
    } catch {
      // If the server is unreachable the pages show their own error; no banner guess here.
    }
  }

  onMount(() => visiblePoll(refresh, 60_000));
</script>

{#if banner}
  <p class="notice" role="status">
    {banner.text} <a href={banner.href}>Open Settings</a>
  </p>
{/if}

<style>
  .notice {
    margin: 0 var(--page-gutter);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    background: var(--fill-hover);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .notice a {
    color: var(--text);
  }
</style>
