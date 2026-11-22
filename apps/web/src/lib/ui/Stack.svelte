<script lang="ts">
  import type { Snippet } from "svelte";

  /** Vertical rhythm: children separated by a token gap (1 to 12, the `--s-n` steps). */
  type Props = { gap?: 1 | 2 | 3 | 4 | 6 | 8 | 12; children: Snippet };
  let { gap = 4, children }: Props = $props();
</script>

<div class="stack" style:gap="var(--s-{gap})">{@render children()}</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
  }
</style>
