<script lang="ts">
  import { getRelated, type RelatedNote } from "$lib/api";

  let { noteId, signature = "" }: { noteId: string; /** changes when notes change, to refresh the list */ signature?: string } = $props();

  let rows = $state<RelatedNote[]>([]);

  $effect(() => {
    const id = noteId;
    void signature;
    if (!id) return;
    let stale = false;
    // Related notes are a nicety: with meaning search off, or on any error, the strip simply stays hidden.
    getRelated(id)
      .then((r) => {
        if (!stale) rows = r;
      })
      .catch(() => {
        if (!stale) rows = [];
      });
    return () => {
      stale = true;
    };
  });
</script>

{#if rows.length > 0}
  <details class="related">
    <summary>Related notes <span class="count">{rows.length}</span></summary>
    <ul>
      {#each rows as r (r.id)}<li><a href={`/?note=${encodeURIComponent(r.id)}`}>{r.title || r.id}</a></li>{/each}
    </ul>
  </details>
{/if}

<style>
  .related {
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
  @media (max-width: 639px) {
    .related {
      padding-inline: var(--s-4);
    }
  }
</style>
