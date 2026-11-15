<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import NotebookText from "@lucide/svelte/icons/notebook-text";
  import Bot from "@lucide/svelte/icons/bot";
  import Settings from "@lucide/svelte/icons/settings";
  import CommandPalette from "$lib/components/CommandPalette.svelte";

  let { children }: { children: Snippet } = $props();
  let paletteOpen = $state(false);

  function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      paletteOpen = !paletteOpen;
    }
  }

  const items = [
    { href: "/", label: "Notes", icon: NotebookText, match: (p: string) => p === "/" },
    { href: "/agents", label: "Agents", icon: Bot, match: (p: string) => p.startsWith("/agents") || p.startsWith("/runs") },
    { href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
  ];
</script>

<svelte:window onkeydown={onKeydown} />

<CommandPalette bind:open={paletteOpen} />

<div class="shell">
  <nav class="rail" aria-label="Main">
    {#each items as item (item.href)}
      {@const Icon = item.icon}
      <a
        class="rail-link"
        class:active={item.match(page.url.pathname)}
        href={item.href}
        aria-label={item.label}
        aria-current={item.match(page.url.pathname) ? "page" : undefined}
        title={item.label}
      >
        <Icon size={20} strokeWidth={1.5} />
      </a>
    {/each}
  </nav>
  <div class="column">
    <header class="strip">
      <span class="brand">Vigil</span>
      <button type="button" class="hint" onclick={() => (paletteOpen = true)}><kbd>⌘K</kbd> to search and run commands</button>
    </header>
    <div class="content">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 56px 1fr;
    height: 100vh;
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    border-right: 1px solid var(--hairline);
    background: var(--surface);
  }

  .rail-link {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    color: var(--ink-muted);
    text-decoration: none;
    transition: color 100ms ease-out, background 100ms ease-out;
  }

  .rail-link:hover {
    color: var(--ink);
  }

  .rail-link.active {
    color: var(--ink);
    background: var(--hairline);
  }

  .column {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    min-height: 0;
  }

  .strip {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: var(--space-2) var(--space-6);
    border-bottom: 1px solid var(--hairline);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .brand {
    font-family: var(--font-serif);
    font-size: var(--text-ui);
    color: var(--ink);
  }

  .hint {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }

  .content {
    min-height: 0;
    min-width: 0;
    overflow: auto;
  }
</style>
