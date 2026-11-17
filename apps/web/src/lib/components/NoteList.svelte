<script lang="ts">
  import { onDestroy } from "svelte";
  import { slugify, type Note, type NoteSummary } from "@vigil/shared";
  import Pin from "@lucide/svelte/icons/pin";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { goto } from "$app/navigation";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import Calendar from "$lib/components/Calendar.svelte";
  import { getStudyHistory, putNote, searchNotes } from "$lib/api";
  import { parseDay } from "$lib/daily";
  import { hasTag, relativeTime, tagTree, viewNotes, type SortKey } from "$lib/note-list";
  import { ROW_HEIGHT, VIRTUALIZE_ABOVE, visibleWindow } from "$lib/window";

  let {
    notes = [],
    pins = [],
    selectedId = null,
    flicker = new Set<string>(),
    onselect,
    oncreated,
    ontogglepin,
  }: {
    notes?: NoteSummary[];
    /** Pinned note ids, most recently pinned first. */
    pins?: string[];
    selectedId?: string | null;
    /** Ids whose title pulses amber once (an agent just landed them). */
    flicker?: Set<string>;
    onselect: (id: string) => void;
    oncreated: (note: Note) => void;
    ontogglepin: (id: string, pinned: boolean) => void;
  } = $props();

  let calendarOpen = $state(false);
  let studyDays = $state(new Set<string>());
  const noteDays = $derived(new Set(notes.filter((n) => parseDay(n.id)).map((n) => n.id)));
  const selectedDay = $derived(selectedId && parseDay(selectedId) ? selectedId : null);
  async function toggleCalendar(): Promise<void> {
    calendarOpen = !calendarOpen;
    if (!calendarOpen) return;
    try {
      studyDays = new Set((await getStudyHistory(90)).filter((d) => d.count > 0).map((d) => d.day));
    } catch {
      studyDays = new Set(); // the calendar still works without the study dots
    }
  }
  function openDay(day: string): void {
    void goto(`/?daily=${day}`);
  }

  let newTitle = $state("");
  let creating = $state(false);
  let error = $state("");
  let scrollTop = $state(0);
  let viewport = $state(800);
  let query = $state("");
  let tag = $state<string | null>(null);
  let sort = $state<SortKey>(readSort());
  // Full-text hits from the server (the body is not in the list payload), merged with the client-side match.
  let hitIds = $state(new Set<string>());
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchInput: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  function readSort(): SortKey {
    try {
      return localStorage.getItem("vigil.sort") === "title" ? "title" : "modified";
    } catch {
      return "modified";
    }
  }
  function setSort(next: SortKey): void {
    sort = next;
    try {
      localStorage.setItem("vigil.sort", next);
    } catch {
      // A blocked store only means the choice is not remembered.
    }
  }

  $effect(() => {
    const q = query.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      hitIds = new Set();
      return;
    }
    searchTimer = setTimeout(() => {
      searchNotes(q)
        .then((hits) => (hitIds = new Set(hits.map((h) => h.id))))
        .catch(() => (hitIds = new Set())); // the client-side match still works
    }, 150);
  });
  onDestroy(() => clearTimeout(searchTimer));

  const tree = $derived(tagTree(notes, tag));
  const tags = $derived(tree.roots);
  // A tag that no longer exists must not leave the list empty.
  $effect(() => {
    if (tag !== null && !notes.some((n) => hasTag(n, tag))) tag = null;
  });
  const shown = $derived(viewNotes(notes, { query, tag, sort, pins, extraIds: hitIds }));
  const pinSet = $derived(new Set(pins));

  // Past a few hundred notes only the rows on screen are rendered (fixed-height rows).
  const windowed = $derived(shown.length > VIRTUALIZE_ABOVE);
  const win = $derived(windowed ? visibleWindow({ total: shown.length, scrollTop, viewport }) : { start: 0, end: shown.length, padTop: 0, padBottom: 0 });
  const rows = $derived(shown.slice(win.start, win.end));

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (title.length === 0 || creating) return;
    creating = true;
    error = "";
    try {
      const note = await putNote(slugify(title), { title, body: "" });
      newTitle = "";
      oncreated(note);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not create note";
    } finally {
      creating = false;
    }
  }

  function clearFilters(): void {
    query = "";
    tag = null;
    searchInput?.focus();
  }

  /** Up and Down move between rows; N jumps to the new-note box; Escape in the search box clears it. */
  function onListKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const buttons = [...(listEl?.querySelectorAll<HTMLButtonElement>("button.open") ?? [])];
      const at = buttons.indexOf(target as HTMLButtonElement);
      const next = buttons[at + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    } else if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      document.getElementById("new-note-title")?.focus();
    }
  }
</script>

<aside class="sidebar" style:--row-height={`${ROW_HEIGHT}px`}>
  <header class="head">
    <label class="find">
      <Search size={16} strokeWidth={1.5} />
      <input
        bind:this={searchInput}
        class="find-input"
        type="search"
        placeholder="Filter notes"
        aria-label="Filter notes"
        bind:value={query}
        onkeydown={(e) => e.key === "Escape" && query !== "" && ((query = ""), e.stopPropagation())}
      />
      {#if query !== ""}
        <button type="button" class="clear" aria-label="Clear the filter" onclick={() => ((query = ""), searchInput?.focus())}><X size={14} strokeWidth={1.5} /></button>
      {/if}
    </label>
    <div class="tools">
      <span class="count" aria-live="polite">{shown.length} {shown.length === 1 ? "note" : "notes"}</span>
      <button type="button" class="calbtn" aria-expanded={calendarOpen} aria-controls="note-calendar" aria-label="Calendar" title="Calendar of daily notes" onclick={() => void toggleCalendar()}><CalendarIcon size={14} strokeWidth={1.5} /></button>
      <select class="sort" aria-label="Sort notes" value={sort} onchange={(e) => setSort(e.currentTarget.value === "title" ? "title" : "modified")}>
        <option value="modified">Recently changed</option>
        <option value="title">Title</option>
      </select>
    </div>
    {#if calendarOpen}
      <div id="note-calendar"><Calendar {noteDays} {studyDays} {selectedDay} onpick={openDay} /></div>
    {/if}
    {#if tags.length > 0}
      <div class="chips" role="group" aria-label="Filter by tag">
        <button type="button" class="chip" class:on={tag === null} aria-pressed={tag === null} onclick={() => (tag = null)}>All</button>
        {#each tags as t (t.tag)}
          <button type="button" class="chip" class:on={tag === t.tag || (tag?.startsWith(`${t.tag}/`) ?? false)} aria-pressed={tag === t.tag} onclick={() => (tag = tag === t.tag ? null : t.tag)}>#{t.tag}</button>
        {/each}
      </div>
      {#if tree.children.length > 0}
        <div class="chips" role="group" aria-label={`Tags under ${tag}`}>
          {#each tree.children as c (c.tag)}
            <button type="button" class="chip" class:on={tag === c.tag} aria-pressed={tag === c.tag} onclick={() => (tag = c.tag)}>#{c.tag.slice((tag?.length ?? 0) + 1)}</button>
          {/each}
        </div>
      {/if}
    {/if}
  </header>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="list"
    role="list"
    bind:this={listEl}
    bind:clientHeight={viewport}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
    onkeydown={onListKeydown}
  >
    {#if win.padTop > 0}<div style:height={`${win.padTop}px`} aria-hidden="true"></div>{/if}
    {#each rows as note (note.id)}
      <div class="row" class:selected={note.id === selectedId} class:pinned={pinSet.has(note.id)} role="listitem">
        <button type="button" class="open" onclick={() => onselect(note.id)} aria-current={note.id === selectedId ? "true" : undefined}>
          <span class="line">
            <span class="title" class:flicker={flicker.has(note.id)}>
              {#if note.author === "agent"}
                <span class="agent-dot" role="img" aria-label={`written by ${note.agentName ?? "an agent"}`} title={`written by ${note.agentName ?? "an agent"}`}></span>
              {/if}{note.title}
            </span>
            <span class="date" title={note.updatedAt}>{relativeTime(note.updatedAt)}</span>
          </span>
          <span class="line sub">
            <span class="snippet">{note.snippet ?? ""}</span>
            {#if note.tags.length > 0}<span class="tag-list">{note.tags.slice(0, 2).map((t) => `#${t}`).join(" ")}</span>{/if}
          </span>
        </button>
        <button
          type="button"
          class="pin"
          class:on={pinSet.has(note.id)}
          aria-label={pinSet.has(note.id) ? `Unpin ${note.title}` : `Pin ${note.title}`}
          aria-pressed={pinSet.has(note.id)}
          title={pinSet.has(note.id) ? "Unpin" : "Pin to the top"}
          onclick={() => ontogglepin(note.id, !pinSet.has(note.id))}
        >
          <Pin size={14} strokeWidth={1.5} />
        </button>
      </div>
    {:else}
      {#if notes.length === 0}
        <p class="empty">Nothing here yet. Type a title below to start your first note.</p>
      {:else}
        <div class="empty">
          <p>No notes match.</p>
          <button type="button" class="link" onclick={clearFilters}>Clear the filter</button>
        </div>
      {/if}
    {/each}
    {#if win.padBottom > 0}<div style:height={`${win.padBottom}px`} aria-hidden="true"></div>{/if}
  </div>

  <form class="create" onsubmit={create}>
    <input id="new-note-title" class="input" type="text" placeholder="Note title" aria-label="New note title" bind:value={newTitle} />
    <button type="submit" class="action" disabled={creating || newTitle.trim().length === 0}>New note</button>
    <a class="fromtext" href="/outline" title="Paste text and get an empty outline to fill in">From text</a>
  </form>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-right: 1px solid var(--hairline);
    background: var(--bg);
  }

  .head {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }

  .find {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 34px;
    padding: 0 var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-muted);
  }

  .find:focus-within {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  .find-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    font-size: var(--text-ui);
    color: var(--ink);
  }

  .find-input::placeholder {
    color: var(--ink-muted);
  }

  .find-input::-webkit-search-cancel-button {
    display: none;
  }

  .clear {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius);
    color: var(--ink-muted);
  }

  .clear:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .fromtext {
    align-self: center;
    font-size: var(--text-label);
    color: var(--ink-muted);
    white-space: nowrap;
  }

  .calbtn {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--ink-muted);
    border-radius: var(--radius);
    padding: var(--space-1);
    cursor: pointer;
    display: inline-flex;
  }
  .calbtn:hover,
  .calbtn[aria-expanded="true"] {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .sort {
    max-width: 150px;
    padding: 2px var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--ink-muted);
    font: inherit;
    font-size: var(--text-label);
  }

  .sort:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .chips {
    display: flex;
    gap: var(--space-1);
    padding-bottom: var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .chip {
    flex: none;
    height: 24px;
    padding: 0 var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    font-size: var(--text-label);
    color: var(--ink-muted);
    white-space: nowrap;
  }

  .chip:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }

  .list {
    flex: 1;
    overflow-y: auto;
  }

  .row {
    position: relative;
    height: var(--row-height);
    border-left: 2px solid transparent;
    border-bottom: 1px solid var(--hairline);
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row.selected {
    border-left-color: var(--ink);
    background: var(--surface-raised);
  }

  .open {
    display: grid;
    align-content: center;
    gap: 2px;
    width: 100%;
    height: 100%;
    padding: 0 var(--space-4) 0 calc(var(--space-4) - 2px);
    text-align: left;
  }

  .line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    font-weight: 500;
    line-height: 1.3;
    color: var(--ink);
  }

  .agent-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: var(--space-2);
    border-radius: 50%;
    background: var(--amber);
    vertical-align: middle;
  }

  /* The one orchestrated moment: the title pulses amber once. With reduced motion the dot alone stays. */
  @media (prefers-reduced-motion: no-preference) {
    .title.flicker {
      animation: flicker 600ms ease-out 1;
    }
  }

  @keyframes flicker {
    0%,
    100% {
      color: var(--ink);
    }
    30% {
      color: var(--amber-ink);
    }
  }

  .date {
    flex: none;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .sub {
    justify-content: flex-start;
  }

  .snippet {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .tag-list {
    flex: none;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .pin {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius);
    background: var(--surface-raised);
    color: var(--ink-muted);
  }

  .row:hover .pin,
  .row:focus-within .pin,
  .pin.on {
    display: grid;
  }

  /* A pinned row keeps its pin beside the date; hovering swaps the date for the pin button. */
  .row.pinned .date {
    margin-right: var(--space-6);
  }

  .row:hover .date,
  .row:focus-within .date {
    visibility: hidden;
  }

  .pin.on {
    color: var(--ink);
  }

  .pin:hover {
    background: var(--hairline);
    color: var(--ink);
  }

  .empty {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    font-size: var(--text-ui);
    color: var(--ink-muted);
  }

  .link {
    justify-self: start;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .create {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--hairline);
  }

  .input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: var(--text-ui);
  }

  .input::placeholder {
    color: var(--ink-muted);
  }

  .action {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: var(--text-ui);
    color: var(--ink);
    white-space: nowrap;
  }

  .action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .action:disabled {
    color: var(--ink-muted);
    cursor: default;
  }

  .error {
    padding: 0 var(--space-4) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--err-ink);
  }
</style>
