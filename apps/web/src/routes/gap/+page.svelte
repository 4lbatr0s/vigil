<script lang="ts">
  import { onDestroy } from "svelte";
  import { ApiError, createFromTemplate, getRun, getRunResult, listAgents, putAgent, startGap, type Passage } from "$lib/api";
  import { splitAnswer, usedPassages, verdict } from "$lib/citations";

  type Step = "ask" | "running" | "done" | "error";

  let step = $state<Step>("ask");
  let question = $state("");
  let asked = $state("");
  let answer = $state("");
  let passages = $state<Passage[]>([]);
  let message = $state("");
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const parts = $derived(splitAnswer(answer, passages));
  const used = $derived(usedPassages(answer, passages));
  const badMarks = $derived(verdict(answer, passages) === "bad-marks");
  
  onDestroy(() => clearTimeout(timer));

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function ask(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      let agent = (await listAgents()).find((a) => a.name === "gap-checker");
      if (!agent) agent = await createFromTemplate("gap-checker");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      asked = question.trim();
      step = "running";
      const started = await startGap(asked);
      passages = started.passages;
      await wait(started.run.id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not ask");
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
      fail(run.error ?? `The agent stopped: ${run.status}`);
      return;
    }
    answer = ((await getRunResult(runId)).text ?? "").trim();
    if (answer === "") fail("No answer came back. Try asking in other words.");
    else step = "done";
  }
</script>

<svelte:head><title>Gap check · Vigil</title></svelte:head>

<div class="page">
  <h1>Gap check</h1>
  <p class="muted">Paste an article, a chapter or a lecture transcript. An agent compares it with your own notes and lists what you already have, what is missing and what disagrees. It only reads the text and your notes.</p>

  <form onsubmit={ask}>
    <textarea rows="8" bind:value={question} aria-label="Text to compare with your notes" placeholder="Paste text here…" maxlength="12000"></textarea>
    <button type="submit" class="btn primary" disabled={busy || question.trim().length < 40}>Compare with my notes</button>
  </form>

  {#if step === "running"}
    <p class="muted" aria-live="polite">Reading your notes…</p>
  {:else if step === "error"}
    <p class="error" role="alert">{message}</p>
  {:else if step === "done"}
    <section aria-label="Answer" aria-live="polite">
      <h2>What the text says, against your notes</h2>
      <p class="answer pre">
        {#each parts as part}
          {#if part.kind === "text"}{part.text}{:else if part.passage}<a class="cite" href={`/?note=${encodeURIComponent(part.passage.noteId)}&line=${part.passage.line}`} title={`${part.passage.title}, line ${part.passage.line}`}>{part.n}</a>{:else}<span class="cite bad" title="This mark points at no line">{part.n}</span>{/if}
        {/each}
      </p>
      {#if badMarks}
        <p class="warn" role="note">A mark points at a note line that was never given. Check the lines below before you trust that point.</p>
      {/if}
      {#if used.length > 0}
        <h3>Your note lines it used</h3>
        <ol class="sources">
          {#each used as p (p.n)}
            <li value={p.n}>
              <a href={`/?note=${encodeURIComponent(p.noteId)}&line=${p.line}`}>{p.title}</a> <span class="muted">line {p.line}</span>
              <blockquote>{p.text}</blockquote>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
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
    font-family: var(--font-serif);
    font-size: var(--text-h3);
  }
  h3 {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  .pre {
    white-space: pre-wrap;
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
  .answer {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    line-height: 1.6;
  }
  .cite {
    display: inline-block;
    min-width: 1.4em;
    margin: 0 0.15em;
    padding: 0 var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    text-align: center;
    color: var(--ink);
    text-decoration: none;
  }
  a.cite:hover {
    background: var(--surface-hover);
  }
  .cite.bad {
    border-color: var(--err);
    color: var(--err-ink);
  }
  .warn {
    padding: var(--space-3);
    border: 1px solid var(--err);
    border-radius: var(--radius);
    color: var(--err-ink);
    font-size: var(--text-label);
  }
  .sources {
    display: grid;
    gap: var(--space-3);
    padding-left: var(--space-6);
  }
  blockquote {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-3);
    border-left: 2px solid var(--hairline);
    color: var(--ink-muted);
    font-family: var(--font-serif);
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
