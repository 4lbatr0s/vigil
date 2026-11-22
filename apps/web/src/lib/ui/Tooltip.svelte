<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tooltip } from "bits-ui";

  /**
   * Replaces the native `title=` attribute. Wrap one focusable element; the label shows on hover
   * and on keyboard focus. `shortcut` is optional ("⌘K").
   */
  type Props = { label: string; shortcut?: string; side?: "top" | "right" | "bottom" | "left"; children: Snippet };
  let { label, shortcut, side = "bottom", children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={400}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="anchor">{@render children()}</span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content {side} sideOffset={6} class="tip">
        {label}{#if shortcut}<kbd>{shortcut}</kbd>{/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  .anchor {
    display: inline-flex;
  }

  :global(.tip) {
    z-index: 60;
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-control);
    background: var(--text);
    color: var(--on-ink);
    font: var(--weight-medium) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  :global(.tip kbd) {
    font: inherit;
    opacity: 0.7;
  }
</style>
