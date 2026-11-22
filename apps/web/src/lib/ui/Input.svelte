<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  /**
   * A text field. Quiet at rest (a soft fill), a clear ring on focus. Use inside `Field`, or give
   * it an `aria-label` when it has no visible label (a search box).
   */
  type Props = Omit<HTMLInputAttributes, "value"> & { value?: string; invalid?: boolean };
  let { value = $bindable(""), invalid = false, ...rest }: Props = $props();
</script>

<input class="input" class:invalid bind:value aria-invalid={invalid || undefined} {...rest} />

<style>
  .input {
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-control);
    background: var(--fill-hover);
    box-shadow: inset 0 0 0 1px var(--line-soft);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
    color: var(--text);
    transition: box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }

  .input::placeholder {
    color: var(--text-3);
  }

  .input:hover {
    background: var(--fill-selected);
  }

  .input:focus-visible {
    outline: none;
    background: var(--paper);
    box-shadow: inset 0 0 0 1px var(--focus), 0 0 0 3px var(--select-wash);
  }

  .invalid {
    box-shadow: inset 0 0 0 1px var(--danger);
  }
</style>
