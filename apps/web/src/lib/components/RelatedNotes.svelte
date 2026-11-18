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
    gap: var(--space-1);
  }
  a {
    font-family: var(--font-serif);
    font-size: var(--text-ui);
  }
  @media (max-width: 639px) {
    .related {
      padding-inline: var(--space-4);
    }
  }
</style>
