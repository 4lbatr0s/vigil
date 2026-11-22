<script lang="ts" module>
  export type MenuItem =
    | { kind?: "item"; label: string; onselect: () => void; danger?: boolean; shortcut?: string; disabled?: boolean }
    | { kind: "separator" };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { DropdownMenu } from "bits-ui";

  /**
   * A menu opened from a trigger. Secondary actions live here so a screen shows one primary
   * action. Keyboard: arrows, Enter, Escape, type-ahead (from Bits UI). Put destructive items
   * last, after a separator.
   */
  type Props = { items: MenuItem[]; label: string; align?: "start" | "end"; trigger: Snippet<[{ props: Record<string, unknown> }]> };
  let { items, label, align = "end", trigger }: Props = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger aria-label={label}>
    {#snippet child({ props })}
      {@render trigger({ props })}
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="ui-menu" {align} sideOffset={6}>
      {#each items as item, i (i)}
        {#if item.kind === "separator"}
          <DropdownMenu.Separator class="ui-menu-sep" />
        {:else}
          <DropdownMenu.Item class="ui-menu-item {item.danger ? 'danger' : ''}" disabled={item.disabled} onSelect={item.onselect}>
            <span>{item.label}</span>
            {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
          </DropdownMenu.Item>
        {/if}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  :global(.ui-menu) {
    z-index: 50;
    min-width: 200px;
    padding: var(--s-1);
    border-radius: var(--r-float);
    background: var(--paper-float);
    box-shadow: var(--elev-float);
  }

  :global(.ui-menu-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-6);
    height: var(--control-h);
    padding: 0 var(--s-3);
    border-radius: var(--r-control);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
    color: var(--text);
    cursor: default;
    outline: none;
  }

  :global(.ui-menu-item[data-highlighted]) {
    background: var(--fill-selected);
  }

  :global(.ui-menu-item.danger) {
    color: var(--danger);
  }

  :global(.ui-menu-item[data-disabled]) {
    opacity: 0.45;
  }

  :global(.ui-menu-item kbd) {
    color: var(--text-3);
    font: inherit;
    font-size: var(--type-meta-size);
  }

  :global(.ui-menu-sep) {
    height: 1px;
    margin: var(--s-1) calc(var(--s-1) * -1);
    background: var(--line-soft);
  }
</style>
