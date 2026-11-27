<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes } from "svelte/elements";

  /**
   * The one list row: notes, agents, approvals, settings entries. Selected is a soft fill, never
   * an outline. Two lines at most: `title` and `meta`, plus an optional `snippet`.
   * Pass `href` to make it a link, `onclick` to make it a button.
   */
  type Props = Omit<HTMLAnchorAttributes, "title" | "onclick" | "children"> & {
    title: string;
    meta?: string;
    snippet?: string;
    selected?: boolean;
    /** Let the snippet wrap onto a second line instead of cutting it off. */
    wrap?: boolean;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    lead?: Snippet;
    trail?: Snippet;
  };
  let { title, meta, snippet, selected = false, wrap = false, href, onclick, lead, trail, ...rest }: Props = $props();
</script>

{#snippet content()}
  {#if lead}<span class="lead">{@render lead()}</span>{/if}
  <span class="body">
    <span class="top">
      <span class="title">{title}</span>
      {#if meta}<span class="meta">{meta}</span>{/if}
    </span>
    {#if snippet}<span class="snippet" class:wrap>{snippet}</span>{/if}
  </span>
  {#if trail}<span class="trail">{@render trail()}</span>{/if}
{/snippet}

{#if href}
  <a class="row" class:selected {href} aria-current={selected ? "page" : undefined} {...rest}>{@render content()}</a>
{:else}
  <button type="button" class="row" class:selected aria-pressed={selected} {onclick}>{@render content()}</button>
{/if}

<style>
  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    width: 100%;
    min-height: var(--row-h);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    text-align: left;
    text-decoration: none;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-out);
  }

  .row:hover {
    background: var(--fill-hover);
  }

  .selected,
  .selected:hover {
    background: var(--fill-selected);
  }

  .lead {
    display: inline-flex;
    padding-top: 2px;
    color: var(--text-2);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
  }

  .title {
    overflow: hidden;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    flex: none;
    color: var(--text-3);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .snippet {
    overflow: hidden;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet.wrap {
    white-space: normal;
  }

  .trail {
    display: inline-flex;
    align-items: center;
    align-self: center;
    color: var(--text-2);
  }
</style>
