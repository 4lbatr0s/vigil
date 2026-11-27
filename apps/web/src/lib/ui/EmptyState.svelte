<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The one empty state: what is missing and the single next step. One short sentence, no
   * illustration, no second explanation. `action` holds at most one button.
   */
  type Props = { title: string; action?: Snippet };
  let { title, action }: Props = $props();
</script>

<div class="empty">
  <p>{title}</p>
  {#if action}{@render action()}{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-8) 0;
  }

  p {
    margin: 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
