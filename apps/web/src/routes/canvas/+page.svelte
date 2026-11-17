<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { ApiError, createCanvas, deleteCanvas, listCanvases, type CanvasSummary } from "$lib/api";
  import { relativeTime } from "$lib/note-list";

  let canvases = $state<CanvasSummary[] | null>(null);
  let title = $state("");
  let error = $state("");
  let busy = $state(false);
  let confirmDelete = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      canvases = await listCanvases();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load canvases";
    }
  }
  onMount(() => void load());

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || title.trim() === "") return;
    busy = true;
    error = "";
    try {
      const c = await createCanvas(title.trim());
      await goto(`/canvas/${encodeURIComponent(c.id)}`);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not create it";
    } finally {
      busy = false;
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteCanvas(id);
      confirmDelete = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : "Could not delete it";
    }
  }
</script>

<svelte:head><title>Canvas · Vigil</title></svelte:head>

<main class="page">
  <h1>Canvas</h1>
  <p class="muted">A free board for your notes: place note cards and your own text anywhere, group them, and draw arrows between them. Boards are saved in your vault as <code>.canvas</code> files, the same open format Obsidian uses.</p>

  <form onsubmit={create}>
    <input type="text" bind:value={title} placeholder="Name a new board, for example Exam plan" aria-label="Name of the new canvas" maxlength="100" />
    <button type="submit" class="primary" disabled={busy || title.trim() === ""}>New canvas</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if canvases === null}
    <p class="muted">Loading…</p>
  {:else if canvases.length === 0}
    <p class="muted">No boards yet. Name one above to start.</p>
  {:else}
    <ul class="list">
      {#each canvases as c (c.id)}
        <li>
          <a class="open" href={`/canvas/${encodeURIComponent(c.id)}`}>
            <strong>{c.id}</strong>
            <span class="muted">{c.nodes} {c.nodes === 1 ? "card" : "cards"} · {relativeTime(c.updatedAt)}</span>
          </a>
          {#if confirmDelete === c.id}
            <span class="muted">Delete this board? Your notes stay.</span>
            <button type="button" class="ghost danger" onclick={() => void remove(c.id)}>Delete</button>
            <button type="button" class="ghost" onclick={() => (confirmDelete = null)}>Keep</button>
          {:else}
            <button type="button" class="ghost" onclick={() => (confirmDelete = c.id)}>Delete</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 720px;
    display: grid;
    gap: var(--space-4);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  code {
    font-family: var(--font-mono);
  }
  form {
    display: flex;
    gap: var(--space-2);
  }
  input {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  .list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  .open {
    flex: 1;
    display: grid;
    gap: var(--space-1);
    color: var(--ink);
    text-decoration: none;
  }
  button.primary,
  button.ghost {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--text-ui);
    cursor: pointer;
  }
  button.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  button.ghost {
    padding: var(--space-1) var(--space-3);
    background: transparent;
    color: var(--ink);
    font-size: var(--text-label);
  }
  button.danger {
    color: var(--err-ink);
    border-color: var(--err);
  }
  button:disabled {
    opacity: 0.5;
  }
  .error {
    color: var(--err-ink);
  }
</style>
