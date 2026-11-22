<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A small status or count. `agent` (amber) is only for agent activity. Keep the text to a word
   * or a number.
   */
  type Props = { tone?: "neutral" | "agent" | "danger"; children: Snippet };
  let { tone = "neutral", children }: Props = $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 var(--s-2);
    border-radius: var(--r-pill);
    font: var(--weight-medium) var(--type-meta-size) / 1 var(--font-ui);
    background: var(--fill-selected);
    color: var(--text-2);
  }

  .agent {
    background: var(--agent-fill);
    color: var(--agent);
  }

  .danger {
    background: var(--danger-fill);
    color: var(--danger);
  }
</style>
