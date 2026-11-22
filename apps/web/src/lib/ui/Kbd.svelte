<script lang="ts">
  /** A keyboard shortcut, shown as the keys the person presses ("⌘K"). */
  let { keys }: { keys: string } = $props();
</script>

<kbd>{keys}</kbd>

<style>
  kbd {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 var(--s-1);
    border-radius: var(--r-control);
    background: var(--fill-hover);
    box-shadow: inset 0 0 0 1px var(--line-soft);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-meta-size) / 1 var(--font-ui);
  }
</style>
