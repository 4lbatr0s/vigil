<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Label, control, hint and error as one unit. The control goes in the default snippet and
   * receives the generated `id` so the label points at it.
   */
  type Props = { label: string; hint?: string; error?: string; children: Snippet<[{ id: string; describedby: string | undefined; invalid: boolean }]> };
  let { label, hint, error, children }: Props = $props();

  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  const describedby = $derived(error ? `${id}-e` : hint ? `${id}-h` : undefined);
</script>

<div class="field">
  <label for={id}>{label}</label>
  {@render children({ id, describedby, invalid: Boolean(error) })}
  {#if error}
    <p id="{id}-e" class="error" role="alert">{error}</p>
  {:else if hint}
    <p id="{id}-h" class="hint">{hint}</p>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  label {
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .hint,
  .error {
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .hint {
    color: var(--text-2);
  }

  .error {
    color: var(--danger);
  }
</style>
