<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The page wrapper: one gutter and one maximum width for every route. A route never sets its
   * own max-width. `width="wide"` is for boards and tables, `"prose"` for reading.
   */
  type Props = { title?: string; width?: "default" | "wide" | "prose"; actions?: Snippet; children: Snippet };
  let { title, width = "default", actions, children }: Props = $props();
</script>

<main class="page {width}">
  {#if title || actions}
    <header>
      {#if title}<h1>{title}</h1>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  {@render children()}
</main>

<style>
  .page {
    width: 100%;
    margin: 0 auto;
    padding: var(--s-8) var(--page-gutter) var(--s-16);
    max-width: var(--page-max);
  }

  .wide {
    max-width: 1200px;
  }

  .prose {
    max-width: var(--measure);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    margin-bottom: var(--s-6);
  }

  h1 {
    margin: 0;
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-ui);
    letter-spacing: var(--type-title-tracking);
  }

  .actions {
    display: flex;
    gap: var(--s-2);
  }
</style>
