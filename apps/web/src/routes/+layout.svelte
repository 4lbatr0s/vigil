<script lang="ts">
  import "@fontsource-variable/newsreader";
  import "@fontsource-variable/schibsted-grotesk";
  import "@fontsource/ibm-plex-mono/400.css";
  import "@fontsource/ibm-plex-mono/500.css";
  import "../app.css";
  import Shell from "$lib/components/Shell.svelte";

  let { children } = $props();
</script>

<Shell>
  {@render children()}
</Shell>
