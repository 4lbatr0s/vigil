<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { ApiError, captureLine, putNote } from "$lib/api";
  import { cleanSource, sourceNote } from "$lib/source-text";
  import { shareLine } from "$lib/share";

  let text = $state("");
  let done = $state(false);
  let error = $state("");
  let busy = $state(false);

  // Something shared from another app arrives here as ?title=&text=&url=. It is shown first; nothing is saved until you press the button.
  onMount(() => {
    text = shareLine(page.url.searchParams);
  });

  // A longer text (an article, a lecture transcript, a caption file) can be saved as its own "Source: ..." note instead.
  let srcTitle = $state("");
  let srcOrigin = $state("");
  let srcText = $state("");
  let srcId = $state("");

  async function pickSource(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      error = "That file is over 1 MB. Paste the part you need instead.";
      return;
    }
    srcText = cleanSource(await file.text());
    if (srcTitle === "") srcTitle = file.name.replace(/\.[^.]+$/, "");
  }

  async function saveSource(): Promise<void> {
    if (busy || srcText.trim() === "") return;
    busy = true;
    error = "";
    try {
      const note = sourceNote(srcTitle, srcText, srcOrigin);
      await putNote(note.id, { title: note.title, body: note.body, tags: note.tags });
      srcId = note.id;
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save the source";
    } finally {
      busy = false;
    }
  }

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || text.trim() === "") return;
    busy = true;
    error = "";
    try {
      await captureLine(text.trim());
      done = true;
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not add it";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Capture · Vigil</title></svelte:head>

<div class="page">
  <h1>Capture</h1>
  {#if done}
    <p>Added to your Inbox note.</p>
    <p><a class="btn" href="/">Back to your notes</a></p>
  {:else}
    <p class="muted">This goes to the end of your Inbox note. Edit it first if you like.</p>
    <form onsubmit={add}>
      <textarea rows="5" bind:value={text} aria-label="What to add to your Inbox" maxlength="2000" placeholder="A thought, a link, a question…"></textarea>
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy || text.trim() === ""}>Add to Inbox</button>
      </div>
    </form>
    <details class="source">
      <summary>Save a longer text as a source note</summary>
      <p class="muted">For an article or a lecture transcript. It becomes a note called "Source: ..." tagged #source, so Ask, the Wiki keeper and the Gap check can use it. Your own notes stay separate.</p>
      {#if srcId}
        <p>Saved. <a href={`/?note=${encodeURIComponent(srcId)}`}>Open the source note</a></p>
      {:else}
        <input type="text" bind:value={srcTitle} placeholder="Title" aria-label="Source title" maxlength="120" />
        <input type="text" bind:value={srcOrigin} placeholder="Where it is from (a link or a course), optional" aria-label="Where the source is from" maxlength="300" />
        <input type="file" accept=".txt,.md,.srt,.vtt,text/plain" aria-label="Open a text or caption file" onchange={(e) => void pickSource(e.currentTarget.files)} />
        <textarea rows="8" bind:value={srcText} aria-label="Source text" placeholder="…or paste the text here"></textarea>
        <div class="row"><button type="button" class="btn" disabled={busy || srcText.trim() === ""} onclick={() => void saveSource()}>Save as a source note</button></div>
      {/if}
    </details>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
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
  .source {
    display: grid;
    gap: var(--space-2);
  }
  .source summary {
    cursor: pointer;
    color: var(--ink-muted);
  }
  .source input[type="text"] {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  textarea {
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    resize: vertical;
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
    text-decoration: none;
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
