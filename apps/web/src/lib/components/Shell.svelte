<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import NotebookText from "@lucide/svelte/icons/notebook-text";
  import Bot from "@lucide/svelte/icons/bot";
  import Settings from "@lucide/svelte/icons/settings";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Sunrise from "@lucide/svelte/icons/sunrise";
  import GraduationCap from "@lucide/svelte/icons/graduation-cap";
  import Menu from "@lucide/svelte/icons/menu";
  import Search from "@lucide/svelte/icons/search";
  import { pendingCount, trackPending } from "$lib/approvals-state";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import ShortcutsHelp from "$lib/components/ShortcutsHelp.svelte";
  import Keyboard from "@lucide/svelte/icons/keyboard";
  import { Badge, IconButton, Kbd } from "$lib/ui";
  import Banner from "$lib/components/Banner.svelte";
  import { onMount } from "svelte";
  import { startLive } from "$lib/live";
  import { trackUnseen, unseenCount } from "$lib/today";
  import { refreshStudyDue, studyDue } from "$lib/study-state";
  import { NOTES_PATH } from "$lib/links";

  let { children }: { children: Snippet } = $props();
  let paletteOpen = $state(false);
  let helpOpen = $state(false);
  /** Narrow screens: the navigation is a drawer. */
  let navOpen = $state(false);
  /** Where a "no model connected" or usage notice belongs: the places that need a model, not every page. */
  const showBanner = $derived(["/agents", "/chat", "/settings", "/approvals"].some((p) => page.url.pathname.startsWith(p)));
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

  /** True while the person is typing somewhere, so a plain key such as ? is just a character. */
  function typing(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest(".cm-editor") !== null);
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      paletteOpen = !paletteOpen;
    } else if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target)) {
      event.preventDefault();
      helpOpen = true;
    } else if (event.key === "Escape" && navOpen) {
      navOpen = false;
    }
  }

  /**
   * The navigation by what the learner does (2026-11-26): four places to work, then the helpers and settings at the
   * bottom. Pages that used to have their own link (Graph, Canvas, the study tools, Chat, Approvals) light up the place
   * they belong to.
   */
  const items = [
    { group: "Main", href: "/", label: "Today", icon: Sunrise, match: (p: string) => p === "/" || p.startsWith("/capture") },
    { group: "Main", href: NOTES_PATH, label: "Notes", icon: NotebookText, match: (p: string) => [NOTES_PATH, "/graph", "/canvas"].some((x) => p.startsWith(x)) },
    { group: "Main", href: "/study", label: "Study", icon: GraduationCap, match: (p: string) => ["/study", "/recall", "/outline", "/gap", "/import"].some((x) => p.startsWith(x)) },
    { group: "Main", href: "/ask", label: "Ask", icon: MessageSquare, match: (p: string) => p.startsWith("/ask") || p.startsWith("/chat") },
    { group: "App", href: "/agents", label: "Helpers", icon: Bot, match: (p: string) => ["/agents", "/runs", "/approvals"].some((x) => p.startsWith(x)) },
    { group: "App", href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
  ];
</script>

<svelte:window onkeydown={onKeydown} />

<CommandPalette bind:open={paletteOpen} />
<ShortcutsHelp bind:open={helpOpen} />

<div class="shell">
  {#if navOpen}
    <button type="button" class="scrim" aria-label="Close menu" onclick={() => (navOpen = false)}></button>
  {/if}
  <nav class="rail" class:open={navOpen} aria-label="Main">
    <span class="mark" aria-hidden="true">Vigil</span>
    {#each items as item, i (item.href)}
      {@const Icon = item.icon}
      {#if i > 0 && items[i - 1]?.group !== item.group}
        <span class="sep" class:push={item.group === "App"} aria-hidden="true"></span>
      {/if}
      <a class="rail-link" class:active={item.match(page.url.pathname)} href={item.href === "/agents" && $pendingCount > 0 ? "/approvals" : item.href} aria-label={item.label} aria-current={item.match(page.url.pathname) ? "page" : undefined}>
        <Icon size={18} strokeWidth={1.5} />
        <span class="text">{item.label}</span>
        {#if item.href === "/agents" && $pendingCount > 0}
          <span class="count" role="img" aria-label={`${$pendingCount} waiting`}><Badge tone="agent">{$pendingCount}</Badge></span>
        {:else if item.href === "/study" && $studyDue > 0}
          <span class="count" role="img" aria-label={`${$studyDue} to study`}><Badge>{$studyDue > 99 ? "99+" : $studyDue}</Badge></span>
        {:else if item.href === "/" && $unseenCount > 0}
          <span class="count" role="img" aria-label={`${$unseenCount} new`}><Badge>{$unseenCount > 99 ? "99+" : $unseenCount}</Badge></span>
        {/if}
      </a>
    {/each}
  </nav>
  <div class="column">
    <header class="strip">
      <span class="nav-toggle">
        <IconButton label="Open menu" aria-expanded={navOpen} onclick={() => (navOpen = !navOpen)}><Menu size={18} strokeWidth={1.5} /></IconButton>
      </span>
      <span class="brand">Vigil</span>
      <button type="button" class="search" onclick={() => (paletteOpen = true)} aria-label="Search notes and run commands">
        <Search size={16} strokeWidth={1.5} />
        <span class="placeholder">Search or run a command</span>
        <span class="keys"><Kbd keys={isMac ? "⌘K" : "Ctrl K"} /></span>
      </button>
      <IconButton label="Keyboard shortcuts" shortcut="?" onclick={() => (helpOpen = true)}><Keyboard size={18} strokeWidth={1.5} /></IconButton>
    </header>
    {#if showBanner}<Banner />{/if}
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
    height: 100dvh;
    background: var(--paper);
    color: var(--text);
    font-family: var(--font-ui);
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--s-1);
    padding: var(--s-3) var(--s-2);
    background: var(--paper-sunk);
  }

  .mark {
    display: none;
    padding: var(--s-2) var(--s-3) var(--s-4);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-prose);
    letter-spacing: var(--type-title-tracking);
  }

  .rail-link {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-3);
    height: var(--control-h);
    padding: 0 var(--s-2);
    border-radius: var(--r-control);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-ui-size) / 1 var(--font-ui);
    text-decoration: none;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }

  .rail-link:hover {
    background: var(--fill-hover);
    color: var(--text);
  }

  .rail-link.active {
    background: var(--fill-selected);
    color: var(--text);
  }

  /* Groups are a gap, not a label. The helpers and settings sit at the bottom of the rail. */
  .sep {
    height: var(--s-3);
  }

  .sep.push {
    flex: 1;
  }

  .text {
    display: none;
  }

  .count {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
  }

  .column {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto 1fr;
    min-width: 0;
    min-height: 0;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-6);
  }

  .brand {
    display: none;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-prose);
  }

  .nav-toggle {
    display: none;
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: min(360px, 100%);
    min-width: 0;
    height: var(--control-h);
    margin-left: auto;
    padding: 0 var(--s-3);
    border-radius: var(--r-control);
    background: var(--fill-hover);
    color: var(--text-3);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out);
  }

  .search:hover {
    background: var(--fill-selected);
  }

  .placeholder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
      padding: 0 var(--s-3);
    }
    .text {
      display: inline;
    }
    .count {
      top: 50%;
      right: var(--s-2);
      transform: translateY(-50%);
    }
  }

  /* Narrow: the navigation is a drawer opened from the top bar. */
  @media (max-width: 639px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      width: 260px;
      background: var(--paper-float);
      transform: translateX(-100%);
      visibility: hidden;
      transition: transform var(--dur-base) var(--ease-out), visibility 0s linear var(--dur-base);
      box-shadow: var(--elev-overlay);
    }
    .rail.open {
      transform: none;
      visibility: visible;
      transition: transform var(--dur-base) var(--ease-out);
    }
    .mark {
      display: block;
    }
    .rail-link {
      justify-content: flex-start;
      padding: 0 var(--s-3);
    }
    .text {
      display: inline;
    }
    .count {
      top: 50%;
      right: var(--s-2);
      transform: translateY(-50%);
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 20;
      background: var(--scrim);
    }
    .nav-toggle {
      display: inline-flex;
    }
    .brand {
      display: block;
    }
    .strip {
      padding: var(--s-2) var(--s-4);
    }
    .search {
      width: auto;
      flex: 1;
    }
    .keys {
      display: none;
    }
  }
</style>
