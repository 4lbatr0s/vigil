<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs } from "bits-ui";

  /**
   * Switches between views of the same thing. Use when there are two to five views and the person
   * picks one at a time. The panel for each tab is the `panel` snippet, called with the tab value.
   */
  type Props = { tabs: { value: string; label: string }[]; value?: string; panel: Snippet<[string]> };
  let { tabs, value = $bindable(tabs[0]?.value ?? ""), panel }: Props = $props();
</script>

<Tabs.Root bind:value>
  <Tabs.List class="ui-tabs">
    {#each tabs as tab (tab.value)}
      <Tabs.Trigger value={tab.value} class="ui-tab">{tab.label}</Tabs.Trigger>
    {/each}
  </Tabs.List>
  {#each tabs as tab (tab.value)}
    <Tabs.Content value={tab.value} class="ui-tab-panel">{@render panel(tab.value)}</Tabs.Content>
  {/each}
</Tabs.Root>

<style>
  :global(.ui-tabs) {
    display: flex;
    gap: var(--s-1);
    padding-bottom: var(--s-2);
    box-shadow: 0 1px 0 var(--line-soft);
  }

  :global(.ui-tab) {
    height: var(--control-h);
    padding: 0 var(--s-3);
    border-radius: var(--r-control);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-ui-size) / 1 var(--font-ui);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }

  :global(.ui-tab:hover) {
    background: var(--fill-hover);
    color: var(--text);
  }

  :global(.ui-tab[data-state="active"]) {
    background: var(--fill-selected);
    color: var(--text);
  }

  :global(.ui-tab-panel) {
    padding-top: var(--s-4);
  }
</style>
