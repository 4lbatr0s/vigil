<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import type { Run, RunEvent } from "@vigil/shared";
  import { ApiError, getRun, undoRun } from "$lib/api";
  import { formatStamp } from "$lib/format";
  import { budgetShare, canUndo, KIND_LABEL, lastSeq, mergeEvents, noteIdOf, noteIdsInMessage, preview } from "$lib/run-log";
  import { statusDot } from "$lib/schedule";
  import StatusDot from "$lib/components/StatusDot.svelte";

  const id = $derived(page.params.id ?? "");

  let run = $state<Run | null>(null);
  let events = $state<RunEvent[]>([]);
  let loadError = $state("");
  let undoError = $state("");
  let undoing = $state(false);
  let open = $state<Record<number, boolean>>({});

  async function load(): Promise<void> {
    try {
      const data = await getRun(id);
      run = data.run;
      events = data.events;
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not load the run";
    }
  }

  async function tail(): Promise<void> {
    try {
      const data = await getRun(id, lastSeq(events));
      run = data.run;
      events = mergeEvents(events, data.events);
    } catch {
      // The next tick tries again.
    }
  }

  onMount(() => {
    void load();
    // Append new lines every 2 s while the run is still going, and stop once it is over.
    const timer = setInterval(() => {
      if (run?.status === "running" && document.visibilityState === "visible") void tail();
    }, 2000);
    return () => clearInterval(timer);
  });

  async function undo(): Promise<void> {
    undoError = "";
    undoing = true;
    try {
      run = await undoRun(id);
    } catch (err) {
      undoError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not undo";
    } finally {
      undoing = false;
    }
  }
</script>

<svelte:head><title>Run · Vigil</title></svelte:head>

<main class="page">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !run}
    <p class="muted">Loading…</p>
  {:else}
    <p class="crumb"><a href="/agents">Agents</a> / <a href={`/agents/${run.agent}`}>{run.agent}</a></p>
    <header class="head">
      <StatusDot state={statusDot({ enabled: true }, run)} label={run.status} />
      <h1>{run.status}{run.undone ? " · undone" : ""}</h1>
    </header>

    <dl class="facts">
      <dt>Started</dt><dd class="mono">{formatStamp(run.startedAt)}</dd>
      <dt>Finished</dt><dd class="mono">{run.finishedAt ? formatStamp(run.finishedAt) : "still running"}</dd>
      <dt>Trigger</dt><dd class="mono">{run.trigger}</dd>
      <dt>Tokens</dt>
      <dd>
        <span class="mono">{run.tokensUsed} / {run.tokenBudget}</span>
        <span class="bar" role="img" aria-label={`${Math.round(budgetShare(run) * 100)}% of the token budget used`}>
          <span class="fill" style:width={`${budgetShare(run) * 100}%`}></span>
        </span>
      </dd>
      {#if run.error}<dt>Error</dt><dd class="mono err">{run.error}</dd>{/if}
      {#if run.touched.length > 0}
        <dt>Notes</dt>
        <dd class="notes">{#each run.touched as n (n)}<a class="mono" href={`/?note=${n}`}>{n}</a>{/each}</dd>
      {/if}
    </dl>

    <div class="actions">
      <button type="button" class="primary" disabled={!canUndo(run) || undoing} onclick={() => void undo()}>
        {run.undone ? "Undone" : undoing ? "Undoing…" : "Undo this run"}
      </button>
    </div>
    {#if undoError}
      <p class="error" role="alert">
        {undoError}
        {#each noteIdsInMessage(undoError) as n (n)} <a href={`/?note=${n}`}>{n}</a>{/each}
      </p>
    {/if}

    <h2 class="section">Log</h2>
    <ol class="log" aria-label="Run log" aria-live={run.status === "running" ? "polite" : "off"}>
      {#each events as e (e.seq)}
        {@const p = preview(e.text)}
        {@const note = noteIdOf(e)}
        <li class="line">
          <span class="kind" class:stop={e.kind === "stop"}>{KIND_LABEL[e.kind]}</span>
          <span class="text">
            {#if open[e.seq]}<span class="full">{e.text}</span>{:else}{p.short}{/if}
            {#if note}<a href={`/?note=${note}`}>open note</a>{/if}
            {#if p.long}
              <button type="button" class="more" onclick={() => (open[e.seq] = !open[e.seq])} aria-expanded={open[e.seq] ?? false}>
                {open[e.seq] ? "less" : "more"}
              </button>
            {/if}
          </span>
        </li>
      {/each}
      {#if run.status === "running"}<li class="line running"><span class="kind">…</span><span class="text">running</span></li>{/if}
    </ol>
  {/if}
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 960px;
  }
  .crumb {
    font-size: var(--text-label);
    margin-bottom: var(--space-3);
    color: var(--ink-muted);
  }
  .crumb a {
    color: var(--ink-muted);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
  }
  h2.section {
    font-size: var(--text-ui);
    font-weight: 600;
    margin: var(--space-6) 0 var(--space-2);
  }
  .muted {
    color: var(--ink-muted);
  }
  .error,
  .err {
    color: var(--err);
  }
  .error {
    margin: var(--space-2) 0;
  }
  .facts {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-label);
    margin: var(--space-4) 0;
  }
  dt {
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .bar {
    display: block;
    height: 2px;
    max-width: 240px;
    background: var(--hairline);
    margin-top: var(--space-1);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ink-muted);
  }
  .notes {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .actions {
    margin: var(--space-3) 0;
  }
  .primary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--bg);
    font-size: var(--text-label);
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .log {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--hairline);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .line {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }
  .kind {
    color: var(--ink);
    letter-spacing: 0.04em;
  }
  .kind.stop {
    font-weight: 500;
  }
  .running .kind,
  .running .text {
    color: var(--amber);
  }
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .full {
    display: block;
    color: var(--ink);
  }
  .text a {
    color: var(--ink);
    margin-left: var(--space-2);
  }
  .more {
    margin-left: var(--space-2);
    color: var(--ink);
    text-decoration: underline;
    font: inherit;
  }
</style>
