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
  <p class="banner" role="status">
    {banner.text} <a href={banner.href}>Open Settings</a>
  </p>
{/if}

<style>
  .banner {
    padding: var(--space-2) var(--space-6);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
    font-size: var(--text-label);
  }
  .banner a {
    color: var(--ink);
    text-decoration: underline;
  }
</style>
