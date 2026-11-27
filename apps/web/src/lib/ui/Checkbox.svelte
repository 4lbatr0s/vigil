<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A choice that is saved with the form (use `Switch` for a setting that applies at once).
   * `detail` is a short second line under the label.
   */
  type Props = { checked?: boolean; label: string; detail?: string; disabled?: boolean; onchange?: (checked: boolean) => void; children?: Snippet };
  let { checked = $bindable(false), label, detail, disabled = false, onchange }: Props = $props();
</script>

<label class="check">
  <input type="checkbox" bind:checked {disabled} onchange={(e) => onchange?.(e.currentTarget.checked)} />
  <span class="text">
    <span class="label">{label}</span>
    {#if detail}<span class="detail">{detail}</span>{/if}
  </span>
</label>

<style>
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    cursor: pointer;
  }

  input {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    accent-color: var(--text);
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  .label {
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .detail {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }
</style>
