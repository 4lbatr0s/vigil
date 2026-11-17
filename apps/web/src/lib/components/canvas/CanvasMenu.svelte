<script module lang="ts">
  /** One line of a context menu. `"-"` is a divider. */
  export type MenuItem = "-" | { label: string; run: () => void; hint?: string; disabled?: boolean; danger?: boolean };
</script>

<script lang="ts">
  import { onMount } from "svelte";

  let { x, y, items, onclose }: { x: number; y: number; items: MenuItem[]; onclose: () => void } = $props();

  let el = $state<HTMLDivElement | undefined>(undefined);
  /** Kept inside the window: opened near an edge, the menu shifts back so no line is cut off. */
  let left = $state(0);
  let top = $state(0);

  onMount(() => {
    const r = el?.getBoundingClientRect();
    left = Math.max(8, Math.min(x, window.innerWidth - (r?.width ?? 0) - 8));
    top = Math.max(8, Math.min(y, window.innerHeight - (r?.height ?? 0) - 8));
    el?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: PointerEvent): void => {
      if (!el?.contains(e.target as Node)) onclose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  });

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(el?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function choose(item: Exclude<MenuItem, "-">): void {
    onclose();
    item.run();
  }
</script>

<div class="menu" role="menu" tabindex="-1" bind:this={el} style:left={`${left}px`} style:top={`${top}px`} onkeydown={onKey}>
  {#each items as item, i (i)}
    {#if item === "-"}
      <div class="rule" role="separator"></div>
    {:else}
      <button type="button" role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => choose(item)}>
        <span>{item.label}</span>
        {#if item.hint}<span class="hint">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 13rem;
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
    font-size: var(--text-label);
  }
  button {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover:not(:disabled),
  button:focus-visible {
    background: var(--surface-hover);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .danger {
    color: var(--err-ink);
  }
  .hint {
    color: var(--ink-muted);
  }
  .rule {
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--hairline);
  }
</style>
