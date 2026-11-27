<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLSelectAttributes } from "svelte/elements";

  /**
   * A native select with the quiet field look (native keeps the phone picker and full keyboard
   * support). Put `<option>` and `<optgroup>` in the children. Use inside `Field`, or give it an
   * `aria-label`.
   */
  type Props = Omit<HTMLSelectAttributes, "value" | "children"> & { value?: string; invalid?: boolean; children: Snippet };
  let { value = $bindable(""), invalid = false, children, ...rest }: Props = $props();
</script>

<select class="select" class:invalid bind:value aria-invalid={invalid || undefined} {...rest}>{@render children()}</select>

<style>
  .select {
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-control);
    background: var(--fill-hover);
    box-shadow: inset 0 0 0 1px var(--line-soft);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
    color: var(--text);
  }

  .select:hover {
    background: var(--fill-selected);
  }

  .select:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--focus), 0 0 0 3px var(--select-wash);
  }

  .invalid {
    box-shadow: inset 0 0 0 1px var(--danger);
  }
</style>
