<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { ApiError, createFromTemplate, enrollRecall, getRecall, getRun, getRunResult, listAgents, listNotes, putAgent, recordRecall, startRecallCheck, type RecallItem, type RecallResult } from "$lib/api";
  import { relativeTime } from "$lib/note-list";

  type Step = "pick" | "write" | "running" | "feedback" | "done" | "error";

  let step = $state<Step>("pick");
  let items = $state<RecallItem[]>([]);
  let titles = $state(new Map<string, string>());
  let recall = $state("");
  let feedback = $state("");
  let message = $state("");
  let busy = $state(false);
  let next = $state<RecallItem | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const noteId = $derived(page.url.searchParams.get("note"));
  const title = $derived(noteId ? (titles.get(noteId) ?? noteId) : "");
  const due = $derived(items.filter((i) => i.isDue));

  onMount(async () => {
    try {
      const [r, notes] = await Promise.all([getRecall(), listNotes()]);
      items = r;
      titles = new Map(notes.map((n) => [n.id, n.title]));
      step = noteId ? "write" : "pick";
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not load");
    }
  });
  onDestroy(() => clearTimeout(timer));

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function check(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!noteId || busy) return;
    busy = true;
    message = "";
    try {
      // The checker has no tools; the note and your words travel in its task. Turned on here because you asked for the check.
      let agent = (await listAgents()).find((a) => a.name === "recall-checker");
      if (!agent) agent = await createFromTemplate("recall-checker");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      await enrollRecall(noteId);
      step = "running";
      const started = await startRecallCheck(noteId, recall.trim());
      await wait(started.id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the check");
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
      fail(run.error ?? `The checker stopped: ${run.status}`);
      return;
    }
    feedback = (await getRunResult(runId)).text ?? "";
    step = "feedback";
  }

  async function record(result: RecallResult): Promise<void> {
    if (!noteId || busy) return;
    busy = true;
    try {
      next = await recordRecall(noteId, result);
      step = "done";
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Recall · Vigil</title></svelte:head>

<div class="page">
  <h1>Recall</h1>

  {#if step === "pick"}
    <p class="muted">Put the note away and write what you remember. That effort, not rereading, is what builds memory.</p>
    {#if due.length > 0}
      <ul class="list">
        {#each due as i (i.noteId)}
          <li><a href={`/recall?note=${encodeURIComponent(i.noteId)}`} data-sveltekit-reload>{titles.get(i.noteId) ?? i.noteId}</a><span class="muted">due {relativeTime(i.due)}</span></li>
        {/each}
      </ul>
    {:else if items.length > 0}
      <p>Nothing to recall right now. Next one is {relativeTime(items[0]!.due)}.</p>
    {:else}
      <p>Open a note and press <strong>Recall</strong> to start. Vigil will bring it back after a day, then 3, 7 and 21 days.</p>
    {/if}
  {:else if step === "write"}
    <p>Without looking at <a href={`/?note=${encodeURIComponent(noteId ?? "")}`} target="_blank" rel="noopener">“{title}”</a>, write everything you can remember about it. Rough is fine.</p>
    <form onsubmit={check}>
      <textarea rows="10" bind:value={recall} aria-label="What you remember" placeholder="Write what comes to mind…" maxlength="6000"></textarea>
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy || recall.trim().length === 0}>Check against my note</button>
        <span class="muted">An agent compares it with the note only. It will not rewrite what you wrote.</span>
      </div>
    </form>
  {:else if step === "running"}
    <p class="muted" aria-live="polite">Reading your note and your answer…</p>
  {:else if step === "feedback"}
    <section aria-labelledby="fb">
      <h2 id="fb">What the checker found</h2>
      <div class="feedback">{feedback}</div>
      <p class="muted">The checker can be wrong. Open <a href={`/?note=${encodeURIComponent(noteId ?? "")}`} target="_blank" rel="noopener">the note</a> to be sure.</p>
    </section>
    <p>How did it go?</p>
    <div class="row">
      <button type="button" class="btn" disabled={busy} onclick={() => void record("most")}>Got most of it</button>
      <button type="button" class="btn" disabled={busy} onclick={() => void record("some")}>Got some</button>
      <button type="button" class="btn" disabled={busy} onclick={() => void record("little")}>Hardly any</button>
    </div>
    {#if message}<p class="error" role="alert">{message}</p>{/if}
  {:else if step === "done"}
    <p>Saved. You will be asked again {next ? relativeTime(next.due) : "later"}.</p>
    <p><a class="btn" href="/">Back to your notes</a></p>
  {:else}
    <p class="error" role="alert">{message}</p>
    <p><a class="btn" href="/recall" data-sveltekit-reload>Start again</a></p>
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
  h2 {
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    font-weight: 500;
    color: var(--ink-muted);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
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
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    resize: vertical;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }
  .feedback {
    white-space: pre-wrap;
    padding: var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    text-decoration: none;
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
