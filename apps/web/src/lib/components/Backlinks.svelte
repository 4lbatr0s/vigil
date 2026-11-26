<script lang="ts">
import { noteHref } from "$lib/links";
  import { plainSnippet } from "$lib/snippet";
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

<!-- Always open under the note (2026-11-26): the links into a note are how a learner finds where an idea is used. Nothing shows when no note links here. -->
{#if failed}
  <p class="backlinks muted">Could not load the notes that link here.</p>
{:else if links.length > 0}
  <section class="backlinks" aria-labelledby="backlinks-head">
    <h2 id="backlinks-head">Linked from <span class="count">{links.length}</span></h2>
    <ul>
      {#each links as l (l.id)}
        <li>
          <a href={noteHref(l.id)}>{l.title || l.id}</a>
          {#if l.snippet}<span class="snippet">{plainSnippet(l.snippet)}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .backlinks {
    margin: var(--s-10) 0 0;
    padding-top: var(--s-4);
    box-shadow: 0 -1px 0 var(--line-soft);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }
  h2 {
    margin: 0;
    color: var(--text-3);
    font: var(--weight-medium) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }
  .count {
    margin-left: var(--s-1);
  }
  ul {
    list-style: none;
    margin: var(--s-3) 0 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
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
</style>
