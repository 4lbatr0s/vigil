<script lang="ts">
  import { slugify, type Note } from "@vigil/shared";
  import { putNote } from "$lib/api";

  let {
    notes = [],
    selectedId = null,
    flicker = new Set<string>(),
    onselect,
    oncreated,
  }: {
    notes?: Note[];
    selectedId?: string | null;
    /** Ids whose title pulses amber once (an agent just landed them). */
    flicker?: Set<string>;
    onselect: (id: string) => void;
    oncreated: (note: Note) => void;
  } = $props();

  let newTitle = $state("");
  let creating = $state(false);
  let error = $state("");

  function formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toISOString().slice(0, 10);
  }

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
</script>

<aside class="sidebar">
  <header class="head">
    <span class="label">Notes</span>
  </header>

  <div class="list">
    {#each notes as note (note.id)}
      <button
        type="button"
        class="row"
        class:selected={note.id === selectedId}
        onclick={() => onselect(note.id)}
      >
        <span class="title" class:flicker={flicker.has(note.id)}>
          {#if note.author === "agent"}
            <span
              class="agent-dot"
              role="img"
              aria-label={`written by ${note.agentName ?? "an agent"}`}
              title={`written by ${note.agentName ?? "an agent"}`}
            ></span>
          {/if}{note.title}
        </span>
        <span class="date">{formatDate(note.updatedAt)}</span>
      </button>
    {:else}
      <p class="empty">No notes yet.</p>
    {/each}
  </div>

  <form class="create" onsubmit={create}>
    <input
      id="new-note-title"
      class="input"
      type="text"
      placeholder="Note title"
      aria-label="New note title"
      bind:value={newTitle}
    />
    <button type="submit" class="action" disabled={creating || newTitle.trim().length === 0}>
      New note
    </button>
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
    padding: var(--space-4);
    border-bottom: 1px solid var(--hairline);
  }

  .label {
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .list {
    flex: 1;
    overflow-y: auto;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border-left: 2px solid transparent;
    border-bottom: 1px solid var(--hairline);
    text-align: left;
  }

  .row:hover {
    background: var(--surface);
  }

  .row.selected {
    border-left-color: var(--ink);
    background: var(--surface);
  }

  .title {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
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
      color: var(--amber);
    }
  }

  .date {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .empty {
    padding: var(--space-4);
    font-size: var(--text-ui);
    color: var(--ink-muted);
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
    background: var(--surface);
  }

  .action:disabled {
    color: var(--ink-muted);
    cursor: default;
  }

  .error {
    padding: 0 var(--space-4) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--err);
  }
</style>
