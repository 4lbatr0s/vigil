<script lang="ts">
import { noteHref } from "$lib/links";
  import type { Passage } from "$lib/api";
  import type { Part } from "$lib/citations";

  /**
   * An answer whose claims carry numbered marks that point at the exact note line behind them,
   * and the list of those lines. A mark that points at nothing is shown in the danger colour.
   * `warning` is shown above the sources when the answer cannot be trusted.
   */
  let {
    parts,
    used,
    warning = null,
    sourcesTitle,
    preserveLines = false,
  }: { parts: Part[]; used: Passage[]; warning?: string | null; sourcesTitle: string; preserveLines?: boolean } = $props();
</script>

<p class="answer" class:pre={preserveLines}>
  {#each parts as part}
    {#if part.kind === "text"}{part.text}{:else if part.passage}<a class="cite" href={noteHref(part.passage.noteId, part.passage.line)} aria-label={`${part.passage.title}, line ${part.passage.line}`}>{part.n}</a>{:else}<span class="cite bad" aria-label="This mark points at no line">{part.n}</span>{/if}
  {/each}
</p>
{#if warning}<p class="warn" role="note">{warning}</p>{/if}
{#if used.length > 0}
  <h3>{sourcesTitle}</h3>
  <ol class="sources">
    {#each used as p (p.n)}
      <li value={p.n}>
        <a href={noteHref(p.noteId, p.line)}>{p.title}</a> <span class="meta">line {p.line}</span>
        <blockquote>{p.text}</blockquote>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .answer {
    margin: 0;
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-prose);
  }

  .pre {
    white-space: pre-wrap;
  }

  .cite {
    display: inline-block;
    min-width: 1.5em;
    margin: 0 0.15em;
    padding: 0 var(--s-1);
    border-radius: var(--r-pill);
    background: var(--fill-selected);
    color: var(--text);
    font: var(--weight-medium) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
    text-align: center;
    text-decoration: none;
  }

  a.cite:hover {
    background: var(--fill-pressed);
  }

  .cite.bad {
    background: var(--danger-fill);
    color: var(--danger);
  }

  .warn {
    margin: 0;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-surface);
    background: var(--danger-fill);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  h3 {
    margin: 0;
    font: var(--weight-strong) var(--type-body-size) / var(--type-body-lh) var(--font-ui);
  }

  .sources {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin: 0;
    padding-left: var(--s-6);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .meta {
    color: var(--text-3);
  }

  blockquote {
    margin: var(--s-1) 0 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    background: var(--fill-hover);
    color: var(--text-2);
  }
</style>
