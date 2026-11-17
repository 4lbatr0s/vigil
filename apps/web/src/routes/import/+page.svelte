<script lang="ts">
  import { goto } from "$app/navigation";
  import { slugify } from "@vigil/shared";
  import { freeId } from "$lib/free-id";
  import { ApiError, listNotes, putNote } from "$lib/api";
  import { ankiToCards } from "$lib/anki";

  /** Past this the text is too big to be a plain card list; the server would refuse it too. */
  const MAX_CHARS = 1_000_000;

  let text = $state("");
  let title = $state("Imported cards");
  let message = $state("");
  let busy = $state(false);

  const result = $derived(text.trim() === "" ? null : ankiToCards(text.slice(0, MAX_CHARS)));

  async function pickFile(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_CHARS) {
      message = "That file is too big. Export fewer cards at a time (under 1 MB).";
      return;
    }
    message = "";
    text = await file.text();
  }

  async function create(): Promise<void> {
    if (!result || result.lines.length === 0 || busy || title.trim() === "") return;
    busy = true;
    try {
      const name = title.trim();
      const body = `## Cards\n\n${result.lines.join("\n\n")}\n`;
      const id = freeId(slugify(name), (await listNotes()).map((n) => n.id));
      const note = await putNote(id, { title: name, body });
      await goto(`/?note=${encodeURIComponent(note.id)}`);
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save the note";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Import cards · Vigil</title></svelte:head>

<div class="page">
  <h1>Import cards</h1>
  <p class="muted">Bring cards in from Anki: in Anki choose File, Export, “Notes in Plain Text”, then open that file here or paste its text. You review the cards first, and they become a normal note. Review history is not imported, so the cards start fresh.</p>

  <label class="file"><span class="muted">Open an exported text file</span><input type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" onchange={pickFile} /></label>
  <textarea rows="8" bind:value={text} aria-label="Exported text" placeholder="…or paste it here" maxlength={MAX_CHARS}></textarea>

  {#if result}
    <p aria-live="polite">{result.lines.length} {result.lines.length === 1 ? "card" : "cards"} found{result.skipped > 0 ? `, ${result.skipped} skipped (empty, repeated or one-sided)` : ""}.</p>
    {#if result.lines.length > 0}
      <ul class="preview">
        {#each result.lines.slice(0, 5) as l, i (i)}<li>{l}</li>{/each}
      </ul>
      {#if result.lines.length > 5}<p class="muted">…and {result.lines.length - 5} more.</p>{/if}
      <label class="field"><span class="muted">Note title</span><input type="text" bind:value={title} /></label>
      <div class="row"><button type="button" class="btn primary" disabled={busy || title.trim() === ""} onclick={() => void create()}>Create the note</button></div>
    {/if}
  {/if}
  {#if message}<p class="error" role="alert">{message}</p>{/if}
</div>

<style>
  .page {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-6);
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
  .file,
  .field {
    display: grid;
    gap: var(--space-1);
  }
  textarea,
  input[type="text"] {
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  .preview {
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-serif);
  }
  .preview li {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .row {
    display: flex;
    gap: var(--space-3);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-ui);
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  .error {
    color: var(--err-ink);
  }
</style>
