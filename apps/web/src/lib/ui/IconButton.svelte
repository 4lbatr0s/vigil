<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Tooltip from "./Tooltip.svelte";

  /**
   * An icon with no text. `label` is required: it names the button for screen readers and shows
   * as a tooltip, so no icon-only button is ever unnamed.
   */
  type Props = Omit<HTMLButtonAttributes, "children" | "aria-label"> & {
    label: string;
    shortcut?: string;
    size?: "md" | "sm";
    pressed?: boolean;
    children: Snippet;
  };

  let { label, shortcut, size = "md", pressed, children, type = "button", ...rest }: Props = $props();
</script>

<Tooltip {label} {shortcut}>
  <button {type} class="icon-btn {size}" aria-label={label} aria-pressed={pressed} {...rest}>
    {@render children()}
  </button>
</Tooltip>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-h);
    height: var(--control-h);
    border-radius: var(--r-control);
    color: var(--text-2);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }

  .sm {
    width: var(--control-h-sm);
    height: var(--control-h-sm);
  }

  .icon-btn:hover {
    background: var(--fill-hover);
    color: var(--text);
  }

  .icon-btn:active,
  .icon-btn[aria-pressed="true"] {
    background: var(--fill-selected);
    color: var(--text);
  }

  .icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
