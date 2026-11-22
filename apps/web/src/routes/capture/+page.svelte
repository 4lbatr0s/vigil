<script lang="ts">
  import { Button, Cluster, Input, Page, Stack, Textarea } from "$lib/ui";
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

<Page title="Capture" width="prose">
  <Stack gap={6}>
    {#if done}
      <p>Added to your Inbox note.</p>
      <div><Button variant="primary" href="/">Back to your notes</Button></div>
    {:else}
      <p class="muted">This goes to the end of your Inbox note. Edit it first if you like.</p>
      <form onsubmit={add}>
        <Textarea rows={5} bind:value={text} aria-label="What to add to your Inbox" maxlength={2000} placeholder="A thought, a link, a question…" />
        <div><Button variant="primary" type="submit" disabled={busy || text.trim() === ""}>Add to inbox</Button></div>
      </form>
      <details>
        <summary>Save a longer text as a source note</summary>
        <Stack gap={3}>
          <p class="muted">For an article or a lecture transcript. It becomes a note called "Source: ..." tagged #source, so Ask, the Wiki keeper and the Gap check can use it. Your own notes stay separate.</p>
          {#if srcId}
            <p>Saved. <a href={`/?note=${encodeURIComponent(srcId)}`}>Open the source note</a></p>
          {:else}
            <Input bind:value={srcTitle} placeholder="Title" aria-label="Source title" maxlength={120} />
            <Input bind:value={srcOrigin} placeholder="Where it is from (a link or a course), optional" aria-label="Where the source is from" maxlength={300} />
            <input type="file" accept=".txt,.md,.srt,.vtt,text/plain" aria-label="Open a text or caption file" onchange={(e) => void pickSource(e.currentTarget.files)} />
            <Textarea rows={8} bind:value={srcText} aria-label="Source text" placeholder="…or paste the text here" />
            <div><Button disabled={busy || srcText.trim() === ""} onclick={() => void saveSource()}>Save as a source note</Button></div>
          {/if}
        </Stack>
      </details>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {/if}
  </Stack>
</Page>

<style>
  p {
    margin: 0;
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  summary {
    margin-bottom: var(--s-3);
    color: var(--text-2);
    cursor: pointer;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
