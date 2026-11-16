<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import NotebookText from "@lucide/svelte/icons/notebook-text";
  import Bot from "@lucide/svelte/icons/bot";
  import Settings from "@lucide/svelte/icons/settings";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Network from "@lucide/svelte/icons/network";
  import Sunrise from "@lucide/svelte/icons/sunrise";
  import GraduationCap from "@lucide/svelte/icons/graduation-cap";
  import Menu from "@lucide/svelte/icons/menu";
  import Search from "@lucide/svelte/icons/search";
  import { pendingCount, trackPending } from "$lib/approvals-state";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import Banner from "$lib/components/Banner.svelte";
  import { onMount } from "svelte";
  import { startLive } from "$lib/live";
  import { trackUnseen, unseenCount } from "$lib/today";
  import { refreshStudyDue, studyDue } from "$lib/study-state";

  let { children }: { children: Snippet } = $props();
  let paletteOpen = $state(false);
  /** Narrow screens: the navigation is a drawer. */
  let navOpen = $state(false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  // Any navigation closes the drawer.
  $effect(() => {
    page.url.pathname;
    navOpen = false;
  });

  // One live event stream for the whole app (falls back to polling inside each page).
  onMount(() => {
    const stopLive = startLive();
    const stopPending = trackPending();
    const stopUnseen = trackUnseen();
    void refreshStudyDue();
    return () => {
      stopLive();
      stopPending();
      stopUnseen();
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      paletteOpen = !paletteOpen;
    } else if (event.key === "Escape" && navOpen) {
      navOpen = false;
    }
  }

  const items = [
    { href: "/", label: "Notes", icon: NotebookText, match: (p: string) => p === "/" },
    { href: "/today", label: "Today", icon: Sunrise, match: (p: string) => p.startsWith("/today") },
    { href: "/study", label: "Study", icon: GraduationCap, match: (p: string) => p.startsWith("/study") },
    { href: "/agents", label: "Agents", icon: Bot, match: (p: string) => p.startsWith("/agents") || p.startsWith("/runs") },
    { href: "/chat", label: "Chat", icon: MessageSquare, match: (p: string) => p.startsWith("/chat") },
    { href: "/graph", label: "Graph", icon: Network, match: (p: string) => p.startsWith("/graph") },
    { href: "/approvals", label: "Approvals", icon: ShieldCheck, match: (p: string) => p.startsWith("/approvals") },
    { href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
  ];
</script>

<svelte:window onkeydown={onKeydown} />

<CommandPalette bind:open={paletteOpen} />

<div class="shell">
  {#if navOpen}
    <button type="button" class="scrim" aria-label="Close menu" onclick={() => (navOpen = false)}></button>
  {/if}
  <nav class="rail" class:open={navOpen} aria-label="Main">
    <span class="mark" aria-hidden="true">Vigil</span>
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
        <span class="text">{item.label}</span>
        {#if item.href === "/approvals" && $pendingCount > 0}
          <span class="badge" aria-label={`${$pendingCount} waiting`}>{$pendingCount}</span>
        {:else if item.href === "/study" && $studyDue > 0}
          <span class="badge" aria-label={`${$studyDue} to study`}>{$studyDue > 99 ? "99+" : $studyDue}</span>
        {:else if item.href === "/today" && $unseenCount > 0}
          <span class="badge" aria-label={`${$unseenCount} new`}>{$unseenCount > 99 ? "99+" : $unseenCount}</span>
        {/if}
      </a>
    {/each}
  </nav>
  <div class="column">
    <header class="strip">
      <button type="button" class="menu" aria-label="Open menu" aria-expanded={navOpen} onclick={() => (navOpen = !navOpen)}>
        <Menu size={20} strokeWidth={1.5} />
      </button>
      <span class="brand">Vigil</span>
      <button type="button" class="search" onclick={() => (paletteOpen = true)} aria-label="Search notes and run commands">
        <Search size={16} strokeWidth={1.5} />
        <span class="placeholder">Search or run a command</span>
        <kbd>{isMac ? "⌘" : "Ctrl "}K</kbd>
      </button>
    </header>
    <Banner />
    <div class="content">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--rail-width) 1fr;
    height: 100vh;
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2);
    border-right: 1px solid var(--hairline);
    background: var(--surface);
  }

  .mark {
    display: none;
    padding: var(--space-2) var(--space-3) var(--space-4);
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    font-weight: 600;
  }

  .rail-link {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: 40px;
    padding: 0 var(--space-2);
    border-radius: var(--radius);
    color: var(--ink-muted);
    text-decoration: none;
    transition: color 100ms ease-out, background 100ms ease-out;
  }

  .text {
    display: none;
    font-size: var(--text-ui);
  }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--ink);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
  }

  .rail-link:hover {
    color: var(--ink);
    background: var(--surface-hover);
  }

  .rail-link.active {
    color: var(--ink);
    background: var(--hairline);
  }

  .column {
    display: grid;
    grid-template-rows: auto auto 1fr;
    min-width: 0;
    min-height: 0;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-6);
    border-bottom: 1px solid var(--hairline);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .brand {
    display: none;
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    font-weight: 600;
    color: var(--ink);
  }

  .menu {
    display: none;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: var(--radius);
    color: var(--ink);
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: min(420px, 100%);
    height: 34px;
    margin-left: auto;
    padding: 0 var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-muted);
    font-size: var(--text-ui);
    text-align: left;
  }

  .search:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .placeholder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .content {
    /* Always the third row, even when the banner renders nothing, so it gets the 1fr and not an auto row. */
    grid-row: 3;
    position: relative;
    min-height: 0;
    min-width: 0;
    overflow: auto;
  }

  .scrim {
    display: none;
  }

  /* Wide: a labelled navigation (ADR-0016). */
  @media (min-width: 1200px) {
    .shell {
      grid-template-columns: var(--nav-width) 1fr;
    }
    .mark {
      display: block;
    }
    .rail-link {
      justify-content: flex-start;
      padding: 0 var(--space-3);
    }
    .text {
      display: inline;
    }
    .badge {
      top: 50%;
      right: var(--space-3);
      transform: translateY(-50%);
    }
  }

  /* Narrow: the navigation is a drawer opened from the top bar. */
  @media (max-width: 639px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .rail {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      width: 260px;
      transform: translateX(-100%);
      visibility: hidden;
      transition: transform 140ms ease-out, visibility 0s linear 140ms;
      box-shadow: var(--shadow-pop);
    }
    .rail.open {
      transform: none;
      visibility: visible;
      transition: transform 140ms ease-out;
    }
    .mark {
      display: block;
    }
    .rail-link {
      justify-content: flex-start;
      padding: 0 var(--space-3);
    }
    .text {
      display: inline;
    }
    .badge {
      top: 50%;
      right: var(--space-3);
      transform: translateY(-50%);
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 20;
      background: color-mix(in srgb, var(--bg) 70%, transparent);
    }
    .menu {
      display: grid;
    }
    .brand {
      display: block;
    }
    .strip {
      padding: var(--space-2) var(--space-4);
    }
    .search {
      width: auto;
      flex: 1;
    }
    kbd {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rail,
    .rail.open {
      transition: none;
    }
  }
</style>
