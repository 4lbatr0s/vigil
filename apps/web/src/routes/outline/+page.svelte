<script lang="ts">
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { slugify } from "@vigil/shared";
  import { freeId } from "$lib/free-id";
  import { ApiError, listNotes, createFromTemplate, getRun, getRunResult, listAgents, putAgent, putNote, startOutline } from "$lib/api";

  type Step = "paste" | "running" | "review" | "error";

  let step = $state<Step>("paste");
  let source = $state("");
  let outline = $state("");
  let message = $state("");
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The first `# Title` line of the outline, or an empty string. */
  const outlineTitle = $derived(/^#\s+(.+)$/m.exec(outline)?.[1]?.trim() ?? "");
  const noteBody = $derived(outline.replace(/^#\s+.+\n?/m, "").trim() + "\n");
  let title = $state("");
  $effect(() => {
    if (step === "review" && title === "") title = outlineTitle;
  });

  onDestroy(() => clearTimeout(timer));

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function make(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      // The outliner has no tools; your text travels in its task. Turned on here because you asked for the outline.
      let agent = (await listAgents()).find((a) => a.name === "outliner");
      if (!agent) agent = await createFromTemplate("outliner");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      step = "running";
      await wait((await startOutline(source.trim())).id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start");
    } finally {
      busy = false;
    }
  }

  async function wait(runId: string): Promise<void> {
    const { run } = await getRun(runId);
    if (run.status === "running") {
      timer = setTimeout(() => void wait(runId).catch((e) => fail(e instanceof Error ? e.message : "Lost track of the run")), 1500);
      return;
    }
    if (run.status !== "succeeded") {
      fail(run.error ?? `The outliner stopped: ${run.status}`);
      return;
    }
    outline = ((await getRunResult(runId)).text ?? "").trim();
    if (outline === "") fail("No outline came back. Try again with a bit more text.");
    else step = "review";
  }

  async function create(): Promise<void> {
    const name = title.trim();
    if (name === "" || busy) return;
    busy = true;
    try {
      const id = freeId(slugify(name), (await listNotes()).map((n) => n.id));
      const note = await putNote(id, { title: name, body: noteBody });
      await goto(`/?note=${encodeURIComponent(note.id)}`);
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save the note";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Study outline · Vigil</title></svelte:head>

<div class="page">
  <h1>Study outline</h1>

  {#if step === "paste"}
    <p class="muted">Paste a lecture transcript, an article or your rough notes. You get headings and a question for each, with the answers left empty: writing them in your own words is where the learning happens.</p>
    <form onsubmit={make}>
      <textarea rows="12" bind:value={source} aria-label="Text to outline" placeholder="Paste text here…" maxlength="20000"></textarea>
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy || source.trim().length < 20}>Make an outline</button>
        <span class="muted">An agent reads only this text. It will not answer the questions for you.</span>
      </div>
    </form>
  {:else if step === "running"}
    <p class="muted" aria-live="polite">Reading your text…</p>
  {:else if step === "review"}
    <p class="muted">Edit anything you like. Your note is saved only when you press the button.</p>
    <label class="field"><span class="muted">Note title</span><input type="text" bind:value={title} /></label>
    <textarea rows="16" bind:value={outline} aria-label="Outline"></textarea>
    {#if message}<p class="error" role="alert">{message}</p>{/if}
    <div class="row">
      <button type="button" class="btn primary" disabled={busy || title.trim() === ""} onclick={() => void create()}>Create the note</button>
      <button type="button" class="btn" onclick={() => ((step = "paste"), (title = ""))}>Start over</button>
    </div>
  {:else}
    <p class="error" role="alert">{message}</p>
    <p><button type="button" class="btn" onclick={() => ((step = "paste"), (message = ""))}>Back</button></p>
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
  form {
    display: grid;
    gap: var(--space-3);
  }
  textarea,
  input {
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  textarea {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
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
  .btn:hover:not(:disabled) {
    background: var(--surface-hover);
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
