<script lang="ts">
import { dailyHref, NOTE_VIEWS, NOTES_PATH } from "$lib/links";
  import { onDestroy } from "svelte";
  import { slugify, type Note, type NoteSummary } from "@vigil/shared";
  import Pin from "@lucide/svelte/icons/pin";
  import Plus from "@lucide/svelte/icons/plus";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import { goto } from "$app/navigation";
  import Calendar from "$lib/components/Calendar.svelte";
  import { getStudyHistory, putNote, searchNotes } from "$lib/api";
  import { parseDay } from "$lib/daily";
  import { hasTag, relativeTime, tagTree, viewNotes, type SortKey } from "$lib/note-list";
  import { ROW_HEIGHT, VIRTUALIZE_ABOVE, visibleWindow } from "$lib/window";
  import { Button, Dialog, EmptyState, Field, IconButton, Input, Menu, Row, ViewSwitch } from "$lib/ui";

  let {
    notes = [],
    pins = [],
    selectedId = null,
    flicker = new Set<string>(),
    createOpen = $bindable(false),
    onselect,
    oncreated,
    ontogglepin,
  }: {
    notes?: NoteSummary[];
    /** Pinned note ids, most recently pinned first. */
    pins?: string[];
    selectedId?: string | null;
    /** Ids that get a brief amber wash once (an agent just landed them). */
    flicker?: Set<string>;
    /** The "New note" dialog; the page opens it from the address (`?new=1`) and its empty state. */
    createOpen?: boolean;
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
    void goto(dailyHref(day));
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
      createOpen = false;
      oncreated(note);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not create the note";
    } finally {
      creating = false;
    }
  }

  function clearFilters(): void {
    query = "";
    tag = null;
    document.getElementById("note-filter")?.focus();
  }

  /** Up and Down move between rows; N opens the new-note dialog; Escape in the filter clears it. */
  function onListKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const buttons = [...(listEl?.querySelectorAll<HTMLButtonElement>(".item > button") ?? [])];
      const at = buttons.indexOf(target as HTMLButtonElement);
      const next = buttons[at + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    } else if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      createOpen = true;
    }
  }

  const sortLabel = $derived(sort === "title" ? "Title" : "Recently changed");
</script>

<aside class="sidebar" style:--item-height="{ROW_HEIGHT}px">
  <header class="head">
    <ViewSwitch label="Ways to see your notes" items={NOTE_VIEWS} current={NOTES_PATH} />
    <div class="find">
      <Input
        id="note-filter"
        type="search"
        placeholder="Filter notes"
        aria-label="Filter notes"
        bind:value={query}
        onkeydown={(e) => e.key === "Escape" && query !== "" && ((query = ""), e.stopPropagation())}
      />
      <IconButton label="New note" shortcut="N" onclick={() => (createOpen = true)}><Plus size={16} strokeWidth={1.5} /></IconButton>
    </div>
    <div class="tools">
      <span class="count" aria-live="polite">{shown.length} {shown.length === 1 ? "note" : "notes"}</span>
      <span class="tool-buttons">
        <IconButton size="sm" label="Calendar of daily notes" pressed={calendarOpen} aria-expanded={calendarOpen} aria-controls="note-calendar" onclick={() => void toggleCalendar()}><CalendarIcon size={14} strokeWidth={1.5} /></IconButton>
        <Menu
          label="Sort notes"
          items={[
            { label: "Recently changed", onselect: () => setSort("modified") },
            { label: "Title", onselect: () => setSort("title") },
          ]}
        >
          {#snippet trigger({ props })}
            <Button variant="ghost" size="sm" {...props}>
              {sortLabel}<ChevronDown size={14} strokeWidth={1.5} />
            </Button>
          {/snippet}
        </Menu>
      </span>
    </div>
    {#if calendarOpen}
      <div id="note-calendar"><Calendar {noteDays} {studyDays} {selectedDay} onpick={openDay} /></div>
    {/if}
    {#if tags.length > 0}
      <div class="tags" role="group" aria-label="Filter by tag">
        <Button variant="ghost" size="sm" pressed={tag === null} onclick={() => (tag = null)}>All</Button>
        {#each tags as t (t.tag)}
          <Button variant="ghost" size="sm" pressed={tag === t.tag || (tag?.startsWith(`${t.tag}/`) ?? false)} onclick={() => (tag = tag === t.tag ? null : t.tag)}>#{t.tag}</Button>
        {/each}
      </div>
      {#if tree.children.length > 0}
        <div class="tags" role="group" aria-label={`Tags under ${tag}`}>
          {#each tree.children as c (c.tag)}
            <Button variant="ghost" size="sm" pressed={tag === c.tag} onclick={() => (tag = c.tag)}>#{c.tag.slice((tag?.length ?? 0) + 1)}</Button>
          {/each}
        </div>
      {/if}
    {/if}
  </header>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="list" role="list" bind:this={listEl} bind:clientHeight={viewport} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)} onkeydown={onListKeydown}>
    {#if win.padTop > 0}<div style:height="{win.padTop}px" aria-hidden="true"></div>{/if}
    {#each rows as note (note.id)}
      <div class="item" class:flicker={flicker.has(note.id)} role="listitem">
        <Row title={note.title} meta={relativeTime(note.updatedAt)} snippet={note.snippet ?? ""} selected={note.id === selectedId} onclick={() => onselect(note.id)}>
          {#snippet lead()}
            {#if note.author === "agent"}
              <span class="agent-dot" role="img" aria-label={`written by ${note.agentName ?? "a helper"}`}></span>
            {/if}
          {/snippet}
        </Row>
        <span class="pin" class:on={pinSet.has(note.id)}>
          <IconButton size="sm" label={pinSet.has(note.id) ? `Unpin ${note.title}` : `Pin ${note.title}`} pressed={pinSet.has(note.id)} onclick={() => ontogglepin(note.id, !pinSet.has(note.id))}><Pin size={14} strokeWidth={1.5} /></IconButton>
        </span>
      </div>
    {:else}
      {#if notes.length === 0}
        <EmptyState title="No notes yet.">
          {#snippet action()}<Button variant="primary" onclick={() => (createOpen = true)}>New note</Button>{/snippet}
        </EmptyState>
      {:else}
        <EmptyState title="No notes match.">
          {#snippet action()}<Button onclick={clearFilters}>Clear the filter</Button>{/snippet}
        </EmptyState>
      {/if}
    {/each}
    {#if win.padBottom > 0}<div style:height="{win.padBottom}px" aria-hidden="true"></div>{/if}
  </div>
</aside>

<Dialog bind:open={createOpen} title="New note">
  <form id="new-note-form" onsubmit={create}>
    <Field label="Title" error={error || undefined}>
      {#snippet children({ id, describedby, invalid })}
        <Input {id} aria-describedby={describedby} {invalid} placeholder="Untitled" bind:value={newTitle} />
      {/snippet}
    </Field>
  </form>
  {#snippet actions()}
    <Button variant="ghost" href="/outline">Start from pasted text</Button>
    <Button variant="primary" type="submit" form="new-note-form" disabled={creating || newTitle.trim().length === 0}>Create note</Button>
  {/snippet}
</Dialog>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--paper);
    /* The one line in the screen: it separates two panes that scroll on their own. */
    box-shadow: inset -1px 0 0 var(--line-soft);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-3) var(--s-2);
  }

  .find {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }

  .tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding-left: var(--s-1);
    color: var(--text-3);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .tool-buttons {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }

  .tags {
    display: flex;
    gap: var(--s-1);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--s-2) var(--s-4);
  }

  .item {
    position: relative;
    height: var(--item-height);
  }

  .item :global(.row) {
    height: 100%;
  }

  .agent-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-top: var(--s-1);
    border-radius: var(--r-pill);
    background: var(--agent);
  }

  /* The one orchestrated moment: a landed agent note washes amber once. Reduced motion drops the wash; the dot stays. */
  .item.flicker::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--r-control);
    background: var(--agent-fill);
    pointer-events: none;
    animation: land var(--dur-slow) var(--ease-out) 2 alternate;
  }

  @keyframes land {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* The pin sits over the end of the snippet line: seen on hover or focus, always when pinned. */
  .pin {
    position: absolute;
    right: var(--s-2);
    bottom: var(--s-1);
    display: none;
  }

  .item:hover .pin,
  .item:focus-within .pin,
  .pin.on {
    display: inline-flex;
  }
</style>
