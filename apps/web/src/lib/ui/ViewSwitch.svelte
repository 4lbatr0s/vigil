<script lang="ts">
  /**
   * Links between two to four views of the same things, each on its own page (for example Notes, Graph and
   * Boards). It looks like Tabs but navigates; use Tabs when the views share one page.
   */
  type Props = { label: string; items: { href: string; label: string }[]; current: string };
  let { label, items, current }: Props = $props();
</script>

<nav class="ui-viewswitch" aria-label={label}>
  {#each items as item (item.href)}
    <a href={item.href} aria-current={item.href === current ? "page" : undefined}>{item.label}</a>
  {/each}
</nav>

<style>
  .ui-viewswitch {
    display: inline-flex;
    align-self: flex-start;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-control);
    background: var(--paper-sunk);
  }

  a {
    display: inline-flex;
    align-items: center;
    height: calc(var(--control-h) - 4px);
    padding: 0 var(--s-3);
    border-radius: var(--r-control);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-meta-size) / 1 var(--font-ui);
    text-decoration: none;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }

  a:hover {
    color: var(--text);
  }

  a[aria-current="page"] {
    background: var(--paper-float);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--line-soft);
  }

  a:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
</style>
