<script lang="ts">
  import "@fontsource-variable/newsreader";
  import "@fontsource-variable/schibsted-grotesk";
  import "@fontsource/ibm-plex-mono/400.css";
  import "@fontsource/ibm-plex-mono/500.css";
  import "../app.css";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onUnauthorized } from "$lib/api";
  import Shell from "$lib/components/Shell.svelte";

  let { children } = $props();

  const onLogin = $derived(page.url.pathname.startsWith("/login"));

  // Any 401 from the API sends the visitor to the login page, then back to where they were.
  onMount(() => {
    onUnauthorized(() => {
      if (page.url.pathname.startsWith("/login")) return;
      const here = `${page.url.pathname}${page.url.search}`;
      void goto(`/login?next=${encodeURIComponent(here)}`, { replaceState: true });
    });
    return () => onUnauthorized(null);
  });
</script>

{#if onLogin}
  {@render children()}
{:else}
  <Shell>
    {@render children()}
  </Shell>
{/if}
