<script lang="ts">
  import { getBacklinks, type Backlink } from "$lib/api";

  let { noteId, signature = "" }: { noteId: string; /** changes when notes change, to refresh the list */ signature?: string } = $props();

  let links = $state<Backlink[]>([]);
  let failed = $state(false);

  $effect(() => {
    const id = noteId;
    void signature;
    if (!id) return;
    let stale = false;
    getBacklinks(id)
      .then((rows) => {
        if (!stale) {
          links = rows;
          failed = false;
        }
      })
      .catch(() => {
        if (!stale) failed = true;
      });
    return () => {
      stale = true;
    };
  });
</script>

<details class="backlinks">
  <summary>Linked from <span class="count">{links.length}</span></summary>
  {#if failed}
    <p class="muted">Could not load the links.</p>
  {:else if links.length === 0}
    <p class="muted">No other note links here yet.</p>
  {:else}
    <ul>
      {#each links as l (l.id)}
        <li>
          <a href={`/?note=${encodeURIComponent(l.id)}`}>{l.title || l.id}</a>
          {#if l.snippet}<span class="snippet">{l.snippet}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</details>

<style>
  .backlinks {
    padding: var(--space-2) var(--space-6);
    border-top: 1px solid var(--hairline);
    font-size: var(--text-label);
  }
  summary {
    cursor: pointer;
    color: var(--ink-muted);
  }
  .count {
    font-family: var(--font-mono);
  }
  ul {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
    max-height: 30vh;
    overflow-y: auto;
  }
  a {
    font-family: var(--font-serif);
    font-size: var(--text-ui);
  }
  .snippet {
    display: block;
    color: var(--ink-muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--ink-muted);
    margin: var(--space-2) 0 0;
  }
</style>
