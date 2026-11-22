<script lang="ts">
  import type { Snippet } from "svelte";

  /** Horizontal group that wraps: a row of buttons, tags or chips, with a token gap. */
  type Props = { gap?: 1 | 2 | 3 | 4 | 6; align?: "start" | "center" | "end" | "between"; children: Snippet };
  let { gap = 2, align = "start", children }: Props = $props();
</script>

<div class="cluster {align}" style:gap="var(--s-{gap})">{@render children()}</div>

<style>
  .cluster {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }

  .start {
    justify-content: flex-start;
  }
  .center {
    justify-content: center;
  }
  .end {
    justify-content: flex-end;
  }
  .between {
    justify-content: space-between;
  }
</style>
