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
    padding: var(--s-1) var(--s-6);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }
  summary {
    cursor: pointer;
    color: var(--text-3);
  }
  summary:hover {
    color: var(--text-2);
  }
  .count {
    margin-left: var(--s-1);
    color: var(--text-3);
  }
  ul {
    list-style: none;
    margin: var(--s-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--s-2);
    max-height: 30vh;
    overflow-y: auto;
  }
  a {
    color: var(--text);
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
    text-underline-offset: 2px;
  }
  li a {
    display: flex;
    gap: var(--s-3);
    padding: var(--s-1) 0;
    text-decoration: none;
  }
  li a:hover .who {
    text-decoration: underline;
  }
  .who {
    color: var(--text);
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
  .what {
    flex: 1;
  }
  @media (max-width: 639px) {
    .activity {
      padding-inline: var(--s-4);
    }
  }
</style>
