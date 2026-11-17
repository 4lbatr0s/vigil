<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { slugify, type Note, type NoteSummary } from "@vigil/shared";
  import { createCanvas, getNote, getStudyStats, saveCanvas, listApprovals, listNotes, listPins, listRuns, pinNote, putNote, unpinNote, type ApprovalItem, type StudyStats } from "$lib/api";
  import { SIZES, noteFile } from "$lib/canvas";
  import { outlineToBoard } from "$lib/canvas-layout";
  import { newAgentNotes } from "$lib/notes-poll";
  import { refreshOnLive } from "$lib/live";
  import NoteList from "$lib/components/NoteList.svelte";
  import Backlinks from "$lib/components/Backlinks.svelte";
  import RenameNote from "$lib/components/RenameNote.svelte";
  import DeleteNote from "$lib/components/DeleteNote.svelte";
  import { nextAfterDelete } from "$lib/after-delete";
  import { dailyNote, parseDay } from "$lib/daily";
  import { fromTemplate, templateById } from "$lib/note-templates";
  import { WELCOME_BODY, WELCOME_ID, WELCOME_TITLE } from "$lib/welcome";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import type { Run } from "@vigil/shared";
  import AskAgent from "$lib/components/AskAgent.svelte";
  import CardMaker from "$lib/components/CardMaker.svelte";
  import StudyWith from "$lib/components/StudyWith.svelte";
  import Illustration from "$lib/components/Illustration.svelte";
  import NoteActivity from "$lib/components/NoteActivity.svelte";
  import ChangeReview from "$lib/components/ChangeReview.svelte";
  import ProvenanceBar from "$lib/components/ProvenanceBar.svelte";
  import { runsForNote, undoableRun } from "$lib/note-activity";

  let notes = $state<NoteSummary[]>([]);
  let selectedId = $state<string | null>(null);
  let draft = $state<{ title: string; body: string } | null>(null);
  let status = $state("");
  // A wikilink that points at no note yet: the inline "create it?" prompt.
  let pendingCreate = $state<string | null>(null);
  let loading = $state(true);
  /** A line named by the address (`&line=4`), scrolled to once when that note opens. */
  let jumpLine = $state<number | null>(null);
  let loadError = $state("");
  let flicker = $state(new Set<string>());
  let pins = $state<string[]>([]);
  // What agents did to this note, and what they are waiting to do (ProvenanceBar and NoteActivity).
  let runs = $state<Run[]>([]);
  let pending = $state<ApprovalItem[]>([]);
  let cardStats = $state<StudyStats | null>(null);
  let askOpen = $state(false);
  let cardsOpen = $state(false);
  let studyOpen = $state(false);
  /** Bumped when the note changed on disk behind the editor, so the editor is rebuilt from the saved text. */
  let reloadKey = $state(0);
  /** The run whose changes are being reviewed hunk by hunk, for the open note only. */
  let review = $state<{ runId: string; noteId: string; agent: string } | null>(null);
  let askSelection = $state<string | null>(null);
  const current = $derived(notes.find((n) => n.id === selectedId));
  const noteRuns = $derived(selectedId ? runsForNote(runs, selectedId) : []);
  const writerRun = $derived(selectedId && current?.author === "agent" ? undoableRun(runs, selectedId, current.agentName) : null);
  const pendingHere = $derived(pending.filter((p) => p.noteId === selectedId));

  async function loadActivity(): Promise<void> {
    try {
      const id = selectedId;
      [runs, pending, cardStats] = await Promise.all([listRuns({ limit: 100 }), listApprovals("pending"), id ? getStudyStats(id) : Promise.resolve(null)]);
    } catch {
      // The panels keep what they had; the next poll tries again.
    }
  }

  /** After "Undo this run": the note on disk changed, so reload it and the lists. */
  async function onUndone(): Promise<void> {
    await pollNotes();
    if (selectedId) await select(selectedId);
    reloadKey += 1;
  }

  /** After cards were saved into the note from the review panel. */
  async function onCardsSaved(): Promise<void> {
    await pollNotes();
    if (selectedId) await select(selectedId);
    reloadKey += 1;
  }
  // The title field: edited in place, saved on Enter or when it loses focus (Escape puts the old title back).
  let titleValue = $state("");
  let titleFocused = $state(false);
  $effect(() => {
    titleValue = draft?.title ?? "";
  });
  const words = $derived.by(() => {
    const text = draft?.body.trim() ?? "";
    return text === "" ? 0 : text.split(/\s+/).length;
  });

  async function commitTitle(): Promise<void> {
    if (!draft || !selectedId) return;
    const next = titleValue.trim();
    if (next === "" || next === draft.title) {
      titleValue = draft.title;
      return;
    }
    draft.title = next;
    await persist(selectedId, draft.body);
  }
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
      void loadActivity();
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
  // /?daily=1 (or a day such as /?daily=2026-11-17) opens that day's note and creates it first when it does not exist yet.
  $effect(() => {
    const asked = page.url.searchParams.get("daily");
    const day = asked === "1" ? new Date() : asked ? parseDay(asked) : null;
    if (!day || loading) return;
    untrack(() => {
      const { id, title } = dailyNote(day);
      void (async () => {
        try {
          if (!notes.some((n) => n.id === id)) onCreated(await putNote(id, { title, body: "" }));
          else await select(id);
        } catch (err) {
          status = err instanceof Error ? err.message : "Could not open today's note";
        }
      })();
    });
  });
  // /?template=lecture starts a note from a template (and opens it if today's already exists).
  $effect(() => {
    const wanted = page.url.searchParams.get("template");
    const template = wanted ? templateById(wanted) : undefined;
    if (!template || loading) return;
    untrack(() => {
      const { id, title, body } = fromTemplate(template);
      void (async () => {
        try {
          if (!notes.some((n) => n.id === id)) onCreated(await putNote(id, { title, body }));
          else await select(id);
        } catch (err) {
          status = err instanceof Error ? err.message : "Could not start the note";
        }
      })();
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
      void loadActivity();
      draft = { title: note.title, body: note.body };
      baseUpdatedAt = note.updatedAt;
      const wantedLine = Number(page.url.searchParams.get("line"));
      jumpLine = Number.isInteger(wantedLine) && wantedLine > 0 && page.url.searchParams.get("note") === note.id ? wantedLine : null;
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
    if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j" && draft) {
      event.preventDefault();
      askSelection = null;
      askOpen = true;
    }
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

  /** From an empty vault: a sample note that teaches by example. */
  async function createWelcome(): Promise<void> {
    try {
      onCreated(await putNote(WELCOME_ID, { title: WELCOME_TITLE, body: WELCOME_BODY }));
    } catch (err) {
      status = err instanceof Error ? err.message : "Could not create the sample note";
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
  /** A new canvas board that already holds this note as a card, opened for you. */
  async function openAsCanvas(): Promise<void> {
    if (!draft || !selectedId) return;
    try {
      const made = await createCanvas(draft.title);
      await saveCanvas(made.id, { nodes: [{ id: "note1", type: "file", x: 0, y: 0, width: SIZES.file.width, height: SIZES.file.height, file: noteFile(selectedId) }], edges: [] }, made.updatedAt);
      await goto(`/canvas/${encodeURIComponent(made.id)}`);
    } catch (err) {
      status = err instanceof Error ? err.message : "Could not make a canvas";
    }
  }

  /** The note's headings as a map: the note on the left, one card per heading, arrows from each heading's parent. */
  async function openAsMap(): Promise<void> {
    if (!draft || !selectedId) return;
    try {
      const made = await createCanvas(`${draft.title} map`);
      await saveCanvas(made.id, outlineToBoard(selectedId, draft.body), made.updatedAt);
      await goto(`/canvas/${encodeURIComponent(made.id)}`);
    } catch (err) {
      status = err instanceof Error ? err.message : "Could not make a map";
    }
  }

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
          <Illustration kind="page" />
          <h2>A blank page, ready when you are.</h2>
          <p>Write your first note, or let an agent start one for you.</p>
          <div class="cta">
            <button type="button" class="act primary" onclick={() => document.getElementById("new-note-title")?.focus()}>Create a note</button>
            <a class="act" href="/agents">Add an agent</a>
          </div>
          <p class="muted-line"><button type="button" class="link" onclick={() => void createWelcome()}>Or start with a sample note</button> that shows what Vigil can do.</p>
        {:else}
          <Illustration kind="page" size={72} />
          <h2>Pick a note to keep going.</h2>
          <p>Choose one from the list, or press ⌘K to find it.</p>
        {/if}
      </div>
    {:else}
      <header class="head">
        <button type="button" class="act list-toggle" aria-label="Show the notes list" onclick={() => (listOpen = true)}><PanelLeft size={16} strokeWidth={1.5} /> Notes</button>
        <input
          class="title"
          type="text"
          aria-label="Note title"
          aria-describedby={titleFocused ? "title-hint" : undefined}
          bind:value={titleValue}
          onfocus={() => (titleFocused = true)}
          onblur={() => ((titleFocused = false), void commitTitle())}
          onkeydown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              titleValue = draft?.title ?? "";
              e.currentTarget.blur();
            }
          }}
        />
        <div class="actions">
          <button type="button" class="act" onclick={() => (studyOpen = true)}>Study</button>
          <button type="button" class="act" onclick={() => (cardsOpen = true)}>Make cards</button>
          <button type="button" class="act" onclick={() => void openAsCanvas()} title="Put this note on a new canvas board">Canvas</button>
          <button type="button" class="act" onclick={() => void openAsMap()} title="Turn this note's headings into a map you can rearrange">Map</button>
          <a class="act" href={`/recall?note=${encodeURIComponent(selectedId ?? "")}`} title="Write what you remember, then see what you missed">Recall</a>
          <RenameNote noteId={selectedId ?? ""} title={draft.title} onrenamed={onRenamed} />
          <DeleteNote noteId={selectedId ?? ""} title={draft.title} ondeleted={onDeleted} />
        </div>
      </header>

      {#if titleFocused}
        <p class="title-hint" id="title-hint">The file name stays the same. Use Rename to change it.</p>
      {/if}

      <ProvenanceBar agentName={current?.author === "agent" ? current.agentName : undefined} writtenAt={current?.updatedAt} run={writerRun} pending={pendingHere} onundone={() => void onUndone()} onreview={() => (review = writerRun && selectedId ? { runId: writerRun.id, noteId: selectedId, agent: current?.agentName ?? "The agent" } : null)} />
      {#if review && review.noteId === selectedId}
        <ChangeReview runId={review.runId} noteId={review.noteId} agentName={review.agent} onclose={() => (review = null)} onchanged={() => void onUndone()} />
      {/if}

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
            {#key reloadKey}<Editor value={draft.body} noteId={selectedId ?? ""} onDocChange={onDocChange} onOpenWikilink={(t) => void openWikilink(t)} getTitles={() => notes.map((n) => n.title)} getTitle={() => draft?.title} onProblem={(m) => (status = m)} onAsk={(sel) => ((askSelection = sel), (askOpen = true))} {jumpLine} />{/key}
          {/await}
        </section>
      </div>

      <NoteActivity runs={noteRuns} />
      <Backlinks noteId={selectedId ?? ""} signature={notes.map((n) => n.updatedAt).join("|")} />

      <footer class="status">
        <span class="path">{selectedId}.md{#if cardStats && cardStats.total > 0}
            · <a class="cards-link" href={`/study?note=${encodeURIComponent(selectedId ?? "")}`}>{cardStats.total} {cardStats.total === 1 ? "card" : "cards"}{cardStats.due + cardStats.new > 0 ? `, ${cardStats.due + cardStats.new} to study` : ""}</a>{/if}</span>
        <span class="state">{words} {words === 1 ? "word" : "words"}{status ? ` · ${status}` : ""}</span>
      </footer>
    {/if}
  </main>
</div>

{#if draft && selectedId}
  <StudyWith bind:open={studyOpen} noteId={selectedId} title={draft.title} />
  <CardMaker bind:open={cardsOpen} noteId={selectedId} onsaved={() => void onCardsSaved()} />
  <AskAgent bind:open={askOpen} noteId={selectedId} title={draft.title} selection={askSelection} />
{/if}

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

  .muted-line {
    font-size: var(--text-label);
  }

  .link {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 2px;
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
    .head .title {
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
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    margin: 0 calc(-1 * var(--space-2));
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink);
  }

  .title:hover {
    background: var(--surface-hover);
  }

  .title:focus {
    background: var(--surface);
    border-color: var(--hairline);
  }

  .title-hint {
    padding: var(--space-1) var(--space-6);
    font-size: var(--text-label);
    color: var(--ink-muted);
    border-bottom: 1px solid var(--hairline);
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

  .cards-link {
    color: var(--ink);
    text-underline-offset: 2px;
  }

  .empty {
    grid-row: 1 / -1;
    align-self: center;
    justify-self: center;
    color: var(--ink-muted);
    font-size: var(--text-ui);
  }
</style>
