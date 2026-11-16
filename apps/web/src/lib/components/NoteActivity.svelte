<script lang="ts">
  import type { Run } from "@vigil/shared";
  import { relativeTime } from "$lib/note-list";

  let { runs = [] }: { runs?: Run[] } = $props();
</script>

{#if runs.length > 0}
  <details class="activity">
    <summary>Agent activity <span class="count">{runs.length}</span></summary>
    <ul>
      {#each runs.slice(0, 20) as r (r.id)}
        <li>
          <a href={`/runs/${encodeURIComponent(r.id)}`}>
            <span class="who">{r.agent}</span>
            <span class="what">{r.undone ? "undone" : r.status}{r.trigger === "chat" ? " (chat)" : ""}</span>
            <span class="when" title={r.startedAt}>{relativeTime(r.startedAt)}</span>
          </a>
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .activity {
    padding: var(--space-2) var(--space-6);
    border-top: 1px solid var(--hairline);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  summary {
    cursor: pointer;
  }

  .count {
    margin-left: var(--space-1);
    font-family: var(--font-mono);
  }

  ul {
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  li a {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    color: var(--ink);
    text-decoration: none;
  }

  li a:hover {
    text-decoration: underline;
  }

  .who {
    font-family: var(--font-serif);
    font-size: var(--text-ui);
  }

  .what {
    flex: 1;
    color: var(--ink-muted);
  }

  .when {
    color: var(--ink-muted);
  }
</style>
