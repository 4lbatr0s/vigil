<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  /**
   * The one button. `primary` is the single main action on a screen (ink fill);
   * `quiet` is the default for everything else; `ghost` has no fill until hover;
   * `danger` is for deleting. Add `icon` for a leading Lucide icon.
   */
  type Props = Omit<HTMLButtonAttributes, "children"> & {
    variant?: "primary" | "quiet" | "ghost" | "danger";
    size?: "md" | "sm";
    icon?: Snippet;
    children: Snippet;
  };

  let { variant = "quiet", size = "md", icon, children, type = "button", ...rest }: Props = $props();
</script>

<button {type} class="btn {variant} {size}" {...rest}>
  {#if icon}<span class="lead" aria-hidden="true">{@render icon()}</span>{/if}
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    height: var(--control-h);
    padding: 0 var(--s-3);
    border-radius: var(--r-control);
    font-family: var(--font-ui);
    font-size: var(--type-ui-size);
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }

  .sm {
    height: var(--control-h-sm);
    padding: 0 var(--s-2);
    font-size: var(--type-meta-size);
  }

  .lead {
    display: inline-flex;
    margin-left: calc(var(--s-1) * -1);
    color: var(--text-2);
  }

  .quiet {
    background: var(--fill-hover);
  }
  .quiet:hover {
    background: var(--fill-selected);
  }
  .quiet:active {
    background: var(--fill-pressed);
  }

  .ghost:hover {
    background: var(--fill-hover);
  }
  .ghost:active {
    background: var(--fill-selected);
  }

  .primary {
    background: var(--text);
    color: var(--on-ink);
  }
  .primary .lead {
    color: inherit;
  }
  .primary:hover {
    background: color-mix(in oklch, var(--text) 86%, var(--paper));
  }

  .danger {
    color: var(--danger);
  }
  .danger:hover {
    background: var(--danger-fill);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
