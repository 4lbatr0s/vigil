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
  .snippet {
    display: block;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    margin: var(--s-2) 0 0;
  }
  @media (max-width: 639px) {
    .backlinks {
      padding-inline: var(--s-4);
    }
  }
</style>
