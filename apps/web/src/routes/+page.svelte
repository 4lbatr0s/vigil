<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { slugify, type Note, type NoteSummary } from "@vigil/shared";
  import { getNote, listNotes, listPins, pinNote, putNote, unpinNote } from "$lib/api";
  import { newAgentNotes } from "$lib/notes-poll";
  import { refreshOnLive } from "$lib/live";
  import NoteList from "$lib/components/NoteList.svelte";
  import Backlinks from "$lib/components/Backlinks.svelte";
  import RenameNote from "$lib/components/RenameNote.svelte";
  import DeleteNote from "$lib/components/DeleteNote.svelte";
  import { nextAfterDelete } from "$lib/after-delete";
  import PanelLeft from "@lucide/svelte/icons/panel-left";

  let notes = $state<NoteSummary[]>([]);
  let selectedId = $state<string | null>(null);
  let draft = $state<{ title: string; body: string } | null>(null);
  let status = $state("");
  // A wikilink that points at no note yet: the inline "create it?" prompt.
  let pendingCreate = $state<string | null>(null);
  let loading = $state(true);
  let loadError = $state("");
  let flicker = $state(new Set<string>());
  let pins = $state<string[]>([]);
  /** Below 1024px the list is a slide-over (ADR-0016); this says whether it is open. */
  let listOpen = $state(false);

  let dirty = false;
  // The updatedAt this editor last saw; sent with every save so a newer change is never overwritten.
  let baseUpdatedAt: string | undefined;

  async function pollNotes(): Promise<void> {
    try {
      const next = await listNotes();
      const landed = newAgentNotes(notes, next);
      notes = next;
      if (landed.length > 0) {
        flicker = new Set(landed);
        setTimeout(() => (flicker = new Set()), 700);
      }
    } catch {
      // Keep the list we have; the next poll tries again.
    }
  }

  onMount(() => {
    // Start polling only after the first load, so opening the page never flickers.
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        [notes, pins] = await Promise.all([listNotes(), listPins().catch(() => [] as string[])]);
        // The address wins over "newest first" when it names a note.
        const asked = page.url.searchParams.get("note");
        const target = asked ?? notes[0]?.id;
        if (target) await select(target);
        // On a phone or a narrow window a notes app opens to its list, unless the address names a note.
        if (!asked && window.matchMedia("(max-width: 1023px)").matches) listOpen = true;
      } catch (err) {
        loadError = err instanceof Error ? err.message : "Could not load notes";
      } finally {
        loading = false;
        stop = refreshOnLive(pollNotes, ["note"], 5000);
      }
    })();
    return () => stop?.();
  });

  // The command palette and run viewer link here: /?note=<id> opens a note, /?new=1 focuses the new-note box.
  $effect(() => {
    // Runs when the address changes, not when the selection does (select() updates the address itself).
    const wanted = page.url.searchParams.get("note");
    untrack(() => {
      if (wanted && !loading && wanted !== selectedId) void select(wanted);
    });
  });
  $effect(() => {
    if (page.url.searchParams.get("new") === "1" && !loading) {
      void tick().then(() => document.getElementById("new-note-title")?.focus());
    }
  });

  async function select(id: string): Promise<void> {
    dirty = false;
    try {
      const note = await getNote(id);
      selectedId = note.id;
      listOpen = false;
      draft = { title: note.title, body: note.body };
      baseUpdatedAt = note.updatedAt;
      // Keep the address in step with the open note, so a reload or a copied link opens the same one.
      if (page.url.searchParams.get("note") !== note.id) replaceState(`/?note=${encodeURIComponent(note.id)}`, {});
    } catch (err) {
      status = err instanceof Error ? err.message : "Could not open note";
    }
  }

  async function persist(id: string, body: string): Promise<void> {
    if (!draft) return;
    try {
      const note = await putNote(id, { title: draft.title, body, baseUpdatedAt });
      notes = notes.map((n) => (n.id === note.id ? note : n));
      baseUpdatedAt = note.updatedAt;
      dirty = false;
      status = `saved ${new Date(note.updatedAt).toTimeString().slice(0, 8)}`;
    } catch (err) {
      status = err instanceof Error ? err.message : "save failed";
    }
  }

  // Autosave: debounce 1000ms after the body changes.
  $effect(() => {
    const id = selectedId;
    const body = draft?.body;
    if (!id || body === undefined) return;
    if (!dirty) return;
    const timer = setTimeout(() => {
      if (dirty) void persist(id, body);
    }, 1000);
    return () => clearTimeout(timer);
  });

  function onDocChange(next: string) {
    if (!draft) return;
    draft.body = next;
    dirty = true;
  }

  async function saveNow(): Promise<void> {
    if (!selectedId || !draft) return;
    await persist(selectedId, draft.body);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && listOpen) listOpen = false;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveNow();
    }
  }

  /** Cmd/Ctrl+click on [[Title]]: open that note, or ask before creating it. */
  async function openWikilink(title: string): Promise<void> {
    const id = slugify(title);
    if (id === "") return;
    if (notes.some((n) => n.id === id)) {
      pendingCreate = null;
      await select(id);
    } else {
      pendingCreate = title;
    }
  }

  async function createPending(): Promise<void> {
    const title = pendingCreate;
    pendingCreate = null;
    if (!title) return;
    try {
      const note = await putNote(slugify(title), { title, body: "" });
      onCreated(note);
    } catch (err) {
      status = err instanceof Error ? err.message : "Could not create the note";
    }
  }

  /** After a rename the id changed: refresh the list and open the note under its new id. */
  async function onRenamed(note: Note): Promise<void> {
    try {
      notes = await listNotes();
    } catch {
      // The poll refreshes the list shortly; opening the renamed note below still works.
    }
    await select(note.id);
  }

  /** After a delete: drop it from the list and open the next note, or show the empty state. */
  async function onDeleted(id: string): Promise<void> {
    const next = nextAfterDelete(notes.map((n) => n.id), id);
    notes = notes.filter((n) => n.id !== id);
    if (next) {
      await select(next);
    } else {
      selectedId = null;
      draft = null;
      replaceState("/", {});
    }
  }

  async function togglePin(id: string, pinned: boolean): Promise<void> {
    const before = pins;
    pins = pinned ? [id, ...pins.filter((p) => p !== id)] : pins.filter((p) => p !== id); // show it at once
    try {
      pins = pinned ? await pinNote(id) : await unpinNote(id);
    } catch (err) {
      pins = before;
      status = err instanceof Error ? err.message : "Could not change the pin";
    }
  }

  function onCreated(note: Note) {
    notes = [note, ...notes.filter((n) => n.id !== note.id)];
    void select(note.id);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  {#if listOpen}
    <button type="button" class="scrim" aria-label="Close the notes list" onclick={() => (listOpen = false)}></button>
  {/if}
  <div class="listpane" class:open={listOpen}>
    <NoteList {notes} {pins} {selectedId} {flicker} onselect={(id) => void select(id)} oncreated={onCreated} ontogglepin={(id, on) => void togglePin(id, on)} />
  </div>

  <main class="main">
    {#if loadError}
      <p class="empty">{loadError}</p>
    {:else if loading}
      <p class="empty">Loading…</p>
    {:else if !draft}
      <div class="empty-state">
        <button type="button" class="act list-toggle" onclick={() => (listOpen = true)}><PanelLeft size={16} strokeWidth={1.5} /> Notes</button>
        {#if notes.length === 0}
          <h2>Your vault is empty.</h2>
          <p>Write your first note, or let an agent start one for you.</p>
          <div class="cta">
            <button type="button" class="act primary" onclick={() => document.getElementById("new-note-title")?.focus()}>Create a note</button>
            <a class="act" href="/agents">Add an agent</a>
          </div>
        {:else}
          <h2>No note selected.</h2>
          <p>Choose one from the list, or press ⌘K to search.</p>
        {/if}
      </div>
    {:else}
      <header class="head">
        <button type="button" class="act list-toggle" aria-label="Show the notes list" onclick={() => (listOpen = true)}><PanelLeft size={16} strokeWidth={1.5} /> Notes</button>
        <h1 class="title">{draft.title}</h1>
        <div class="actions">
          <RenameNote noteId={selectedId ?? ""} title={draft.title} onrenamed={onRenamed} />
          <DeleteNote noteId={selectedId ?? ""} title={draft.title} ondeleted={onDeleted} />
        </div>
      </header>

      {#if pendingCreate}
        <div class="prompt" role="alertdialog" aria-label="Create note">
          <span>No note called “{pendingCreate}” yet. Create it?</span>
          <button type="button" class="act primary" onclick={() => void createPending()}>Create</button>
          <button type="button" class="act" onclick={() => (pendingCreate = null)}>Cancel</button>
        </div>
      {/if}

      <div class="panes">
        <section class="pane editor-pane">
          <!-- The editor (CodeMirror) is the heavy part: load it after the shell and list. -->
          {#await import("$lib/components/Editor.svelte") then { default: Editor }}
            <Editor value={draft.body} noteId={selectedId ?? ""} onDocChange={onDocChange} onOpenWikilink={(t) => void openWikilink(t)} getTitles={() => notes.map((n) => n.title)} />
          {/await}
        </section>
      </div>

      <Backlinks noteId={selectedId ?? ""} signature={notes.map((n) => n.updatedAt).join("|")} />

      <footer class="status">
        <span class="path">{selectedId}.md</span>
        <span class="state">{status}</span>
      </footer>
    {/if}
  </main>
</div>

<style>
  .app {
    position: relative;
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    height: 100%;
  }

  .listpane {
    min-width: 0;
    min-height: 0;
  }

  .scrim,
  .act.list-toggle {
    display: none;
  }

  .empty-state {
    align-self: center;
    justify-self: center;
    display: grid;
    gap: var(--space-3);
    max-width: 36ch;
    padding: var(--space-6);
    text-align: center;
    color: var(--ink-muted);
  }

  .empty-state h2 {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    font-weight: 600;
    color: var(--ink);
  }

  .cta {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
  }

  .act {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink);
    text-decoration: none;
  }

  /* Below 1024px the list is a slide-over; the Notes button opens it (ux-spec section 1). */
  @media (max-width: 1023px) {
    .app {
      grid-template-columns: 1fr;
    }
    .listpane {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 10;
      width: min(var(--sidebar-width), 88vw);
      transform: translateX(-100%);
      visibility: hidden;
      transition: transform 140ms ease-out, visibility 0s linear 140ms;
      box-shadow: var(--shadow-pop);
    }
    .listpane.open {
      transform: none;
      visibility: visible;
      transition: transform 140ms ease-out;
    }
    .scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 9;
      background: color-mix(in srgb, var(--bg) 60%, transparent);
    }
    .act.list-toggle {
      display: inline-flex;
    }
    .head {
      flex-wrap: wrap;
      justify-content: flex-start;
    }
    .actions {
      margin-left: auto;
    }
    .pane {
      padding: var(--space-4);
    }
  }

  @media (max-width: 639px) {
    .listpane {
      width: 100%;
    }
    .head {
      padding: var(--space-3) var(--space-4);
    }
    .actions {
      order: 1;
      margin-left: auto;
    }
    .title {
      order: 2;
      flex-basis: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .listpane,
    .listpane.open {
      transition: none;
    }
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }

  .actions {
    position: relative;
    display: flex;
    gap: var(--space-2);
  }

  .head {
    position: relative;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--hairline);
  }

  .title {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink);
  }

  .panes {
    display: grid;
    grid-template-columns: 1fr;
    flex: 1;
    min-height: 0;
  }

  .prompt {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-6);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
    font-size: var(--text-label);
  }

  .act {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: var(--text-label);
  }

  .act.primary {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }

  .pane {
    min-width: 0;
    overflow: auto;
    padding: var(--space-6);
  }

  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-6);
    border-top: 1px solid var(--hairline);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .empty {
    grid-row: 1 / -1;
    align-self: center;
    justify-self: center;
    color: var(--ink-muted);
    font-size: var(--text-ui);
  }
</style>
