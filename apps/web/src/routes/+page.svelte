<script lang="ts">
  import { onMount, tick } from "svelte";
  import { page } from "$app/state";
  import type { Note, NoteSummary } from "@vigil/shared";
  import { getNote, listNotes, putNote } from "$lib/api";
  import { renderMarkdown } from "$lib/render";
  import { newAgentNotes } from "$lib/notes-poll";
  import { refreshOnLive } from "$lib/live";
  import NoteList from "$lib/components/NoteList.svelte";

  let notes = $state<NoteSummary[]>([]);
  let selectedId = $state<string | null>(null);
  let draft = $state<{ title: string; body: string } | null>(null);
  let status = $state("");
  let showPreview = $state(true);
  let loading = $state(true);
  let loadError = $state("");
  let flicker = $state(new Set<string>());

  let dirty = false;
  // The updatedAt this editor last saw; sent with every save so a newer change is never overwritten.
  let baseUpdatedAt: string | undefined;

  const html = $derived(draft ? renderMarkdown(draft.body) : "");

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
        notes = await listNotes();
        const first = notes[0];
        if (first) await select(first.id);
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
    const wanted = page.url.searchParams.get("note");
    if (wanted && !loading && wanted !== selectedId) void select(wanted);
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
      draft = { title: note.title, body: note.body };
      baseUpdatedAt = note.updatedAt;
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveNow();
    }
  }

  function onCreated(note: Note) {
    notes = [note, ...notes.filter((n) => n.id !== note.id)];
    void select(note.id);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <NoteList {notes} {selectedId} {flicker} onselect={(id) => void select(id)} oncreated={onCreated} />

  <main class="main">
    {#if loadError}
      <p class="empty">{loadError}</p>
    {:else if loading}
      <p class="empty">Loading…</p>
    {:else if !draft}
      <p class="empty">No note selected — choose one from the list.</p>
    {:else}
      <header class="head">
        <h1 class="title">{draft.title}</h1>
        <button
          type="button"
          class="toggle"
          class:active={showPreview}
          onclick={() => (showPreview = !showPreview)}
        >
          {showPreview ? "Preview" : "Source"}
        </button>
      </header>

      <div class="panes" class:source-only={!showPreview}>
        <section class="pane editor-pane">
          <!-- The editor (CodeMirror) and preview (marked, DOMPurify) are the heavy part: load them after the shell and list. -->
          {#await import("$lib/components/Editor.svelte") then { default: Editor }}
            <Editor value={draft.body} noteId={selectedId ?? ""} onDocChange={onDocChange} />
          {/await}
        </section>
        {#if showPreview}
          <section class="pane preview-pane">
            {#await import("$lib/components/Preview.svelte") then { default: Preview }}
              <Preview {html} />
            {/await}
          </section>
        {/if}
      </div>

      <footer class="status">
        <span class="path">{selectedId}.md</span>
        <span class="state">{status}</span>
      </footer>
    {/if}
  </main>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    height: 100%;
  }

  .main {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-width: 0;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }

  .head {
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

  .toggle {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    letter-spacing: 0.04em;
  }

  .toggle.active {
    background: var(--ink);
    color: var(--bg);
  }

  .panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 0;
  }

  .panes.source-only {
    grid-template-columns: 1fr;
  }

  .pane {
    min-width: 0;
    overflow: auto;
    padding: var(--space-6);
  }

  .editor-pane {
    border-right: 1px solid var(--hairline);
  }

  .panes.source-only .editor-pane {
    border-right: none;
  }

  .preview-pane {
    background: var(--bg);
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
