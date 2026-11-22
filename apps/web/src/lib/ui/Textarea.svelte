<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";

  /** A multi-line field with the same quiet look as `Input`. Use inside `Field`, or give it an `aria-label`. */
  type Props = Omit<HTMLTextareaAttributes, "value"> & { value?: string; invalid?: boolean; /** The element, for focusing it. */ el?: HTMLTextAreaElement };
  let { value = $bindable(""), invalid = false, el = $bindable(), ...rest }: Props = $props();
</script>

<textarea class="textarea" class:invalid bind:this={el} bind:value aria-invalid={invalid || undefined} {...rest}></textarea>

<style>
  .textarea {
    width: 100%;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-control);
    background: var(--fill-hover);
    box-shadow: inset 0 0 0 1px var(--line-soft);
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-prose);
    color: var(--text);
    resize: vertical;
    transition: box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }

  .textarea::placeholder {
    color: var(--text-3);
  }

  .textarea:hover {
    background: var(--fill-selected);
  }

  .textarea:focus-visible {
    outline: none;
    background: var(--paper);
    box-shadow: inset 0 0 0 1px var(--focus), 0 0 0 3px var(--select-wash);
  }

  .invalid {
    box-shadow: inset 0 0 0 1px var(--danger);
  }
</style>
