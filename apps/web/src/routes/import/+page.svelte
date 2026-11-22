<script lang="ts">
  import { Button, Field, Input, Page, Stack, Textarea } from "$lib/ui";
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

<Page title="Import cards" width="prose">
  <Stack gap={6}>
    <p class="muted">Bring cards in from Anki: in Anki choose File, Export, “Notes in Plain Text”, then open that file here or paste its text. You review the cards first, and they become a normal note. Review history is not imported, so the cards start fresh.</p>
    <Field label="Open an exported text file">
      {#snippet children({ id })}
        <input {id} type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" onchange={pickFile} />
      {/snippet}
    </Field>
    <Textarea rows={8} bind:value={text} aria-label="Exported text" placeholder="…or paste it here" maxlength={MAX_CHARS} />
    {#if result}
      <p aria-live="polite">{result.lines.length} {result.lines.length === 1 ? "card" : "cards"} found{result.skipped > 0 ? `, ${result.skipped} skipped (empty, repeated or one-sided)` : ""}.</p>
      {#if result.lines.length > 0}
        <ul class="preview">
          {#each result.lines.slice(0, 5) as l, i (i)}<li>{l}</li>{/each}
        </ul>
        {#if result.lines.length > 5}<p class="muted">…and {result.lines.length - 5} more.</p>{/if}
        <Field label="Note title">
          {#snippet children({ id })}<Input {id} bind:value={title} />{/snippet}
        </Field>
        <div><Button variant="primary" disabled={busy || title.trim() === ""} onclick={() => void create()}>Create the note</Button></div>
      {/if}
    {/if}
    {#if message}<p class="error" role="alert">{message}</p>{/if}
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

  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: var(--s-3) var(--s-4) var(--s-3) var(--s-6);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
