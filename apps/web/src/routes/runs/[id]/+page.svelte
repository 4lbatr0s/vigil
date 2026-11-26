<script lang="ts">
import { noteHref } from "$lib/links";
  import { Button, Dialog, Page, Stack, Textarea } from "$lib/ui";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import type { Run, RunEvent } from "@vigil/shared";
  import { goto } from "$app/navigation";
  import { ApiError, cancelRun, getRun, runAgent, undoRun } from "$lib/api";
  import { formatStamp } from "$lib/format";
  import { budgetShare, canUndo, childRunIdOf, configOf, KIND_LABEL, lastSeq, mergeEvents, noteIdOf, noteIdsInMessage, preview, stepStats, taskOf } from "$lib/run-log";
  import { refreshOnLive } from "$lib/live";
  import { statusDot } from "$lib/schedule";
  import StatusDot from "$lib/components/StatusDot.svelte";

  const id = $derived(page.params.id ?? "");

  let run = $state<Run | null>(null);
  let events = $state<RunEvent[]>([]);
  let loadError = $state("");
  let undoError = $state("");
  let undoing = $state(false);
  let cancelling = $state(false);
  let rerunning = $state(false);
  let rerunOpen = $state(false);
  let rerunTask = $state("");
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
    // New log lines arrive with the live stream; with no stream it polls every 2 s. Either way only while running.
    return refreshOnLive(
      () => {
        if (run?.status === "running") return tail();
      },
      ["run-event", "run"],
      2000,
    );
  });

  async function cancel(): Promise<void> {
    undoError = "";
    cancelling = true;
    try {
      await cancelRun(id);
      await tail();
    } catch (err) {
      undoError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not cancel";
    } finally {
      cancelling = false;
    }
  }

  function openRerun(): void {
    rerunTask = taskOf(events);
    rerunOpen = true;
  }

  async function rerun(): Promise<void> {
    if (!run) return;
    undoError = "";
    rerunning = true;
    try {
      // An empty task means the agent's own default task. Otherwise the run gets the text as edited here.
      const next = await runAgent(run.agent, rerunTask.trim() === "" ? undefined : rerunTask.trim());
      rerunOpen = false;
      await goto(`/runs/${encodeURIComponent(next.id)}`);
    } catch (err) {
      undoError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the run";
    } finally {
      rerunning = false;
    }
  }

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

<Page>
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !run}
    <p class="muted">Loading…</p>
  {:else}
    <Stack gap={6}>
      <header class="head">
        <Button variant="ghost" size="sm" href={`/agents/${run.agent}`}>{run.agent}</Button>
        <div class="titlebar">
          <StatusDot state={statusDot({ enabled: true }, run)} label={run.status} />
          <h1>{run.status}{run.undone ? " · undone" : ""}</h1>
          <span class="grow"></span>
          {#if run.status === "running"}
            <Button variant="quiet" disabled={cancelling} onclick={() => void cancel()}>{cancelling ? "Cancelling…" : "Cancel run"}</Button>
          {:else}
            <Button variant="quiet" disabled={rerunning} onclick={openRerun}>Run again</Button>
            <Button variant="primary" disabled={!canUndo(run) || undoing} onclick={() => void undo()}>{run.undone ? "Undone" : undoing ? "Undoing…" : "Undo this run"}</Button>
          {/if}
        </div>
      </header>

      {#if undoError}
        <p class="error" role="alert">
          {undoError}
          {#each noteIdsInMessage(undoError) as n (n)} <a href={noteHref(n)}>{n}</a>{/each}
        </p>
      {/if}

      <dl class="facts">
        <dt>Started</dt><dd>{formatStamp(run.startedAt)}</dd>
        <dt>Finished</dt><dd>{run.finishedAt ? formatStamp(run.finishedAt) : "still running"}</dd>
        <dt>Trigger</dt><dd>{run.trigger}</dd>
        {#if configOf(events)}<dt>Setup</dt><dd class="mono" title="A fingerprint of the helper's instructions, tools and limits when this run started">{configOf(events)}</dd>{/if}
        {#if run.parentRunId}<dt>Parent</dt><dd><a href={`/runs/${encodeURIComponent(run.parentRunId)}`}>parent run</a></dd>{/if}
        <dt>Tokens</dt>
        <dd>
          {run.tokensUsed} of {run.tokenBudget}
          <span class="bar" role="img" aria-label={`${Math.round(budgetShare(run) * 100)}% of the spending limit used`}>
            <span class="fill" style:width={`${budgetShare(run) * 100}%`}></span>
          </span>
        </dd>
        <dt>Trace</dt><dd><a href={`/api/runs/${encodeURIComponent(run.id)}/trace`} download>Download as JSON Lines</a></dd>
        <dt>Eval case</dt><dd><a href={`/api/runs/${encodeURIComponent(run.id)}/eval-case`} download>Download as eval case</a></dd>
        {#if run.error}<dt>Error</dt><dd class="err">{run.error}</dd>{/if}
        {#if run.touched.length > 0}
          <dt>Notes</dt>
          <dd class="notes">{#each run.touched as n (n)}<a href={noteHref(n)}>{n}</a>{/each}</dd>
        {/if}
      </dl>

      <section aria-labelledby="log-title">
        <h2 id="log-title">Log</h2>
        <ol class="log" aria-label="Run log" aria-live={run.status === "running" ? "polite" : "off"}>
          {#each events as e (e.seq)}
            {@const p = preview(e.text)}
            {@const note = noteIdOf(e)}
            {@const child = childRunIdOf(e)}
            <li class="line">
              <span class="kind" class:stop={e.kind === "stop"}>{KIND_LABEL[e.kind]}</span>
              <span class="text">
                {#if open[e.seq]}<span class="full">{e.text}</span>{:else}{p.short}{/if}
                {#if stepStats(e)}<span class="stats">{stepStats(e)}</span>{/if}
                {#if note}<a href={noteHref(note)}>open note</a>{/if}
                {#if child}<a href={`/runs/${encodeURIComponent(child)}`}>open child run</a>{/if}
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
      </section>
    </Stack>
  {/if}
</Page>

<Dialog bind:open={rerunOpen} title="Run again" description="Change the task if you like. Leave it empty to use the helper's own task.">
  <Textarea rows={5} bind:value={rerunTask} maxlength={4000} aria-label="Task" />
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (rerunOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={rerunning} onclick={() => void rerun()}>{rerunning ? "Starting…" : "Start run"}</Button>
  {/snippet}
</Dialog>

<style>
  h1 {
    margin: 0;
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-ui);
    letter-spacing: var(--type-title-tracking);
  }

  h2 {
    margin: 0 0 var(--s-2);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
  }

  .titlebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
  }

  .grow {
    flex: 1;
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error,
  .err {
    margin: 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .facts {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: var(--s-2) var(--s-4);
    margin: 0;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  dt {
    color: var(--text-2);
  }

  dd {
    margin: 0;
  }

  .bar {
    display: block;
    height: 4px;
    max-width: 240px;
    margin-top: var(--s-1);
    border-radius: var(--r-pill);
    background: var(--fill-selected);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: var(--r-pill);
    background: var(--text-2);
  }

  .notes {
    display: flex;
    gap: var(--s-3);
    flex-wrap: wrap;
  }

  .log {
    list-style: none;
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-body-lh) var(--font-code);
    color: var(--text-2);
  }

  .line {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: var(--s-3);
  }

  .kind {
    color: var(--text);
  }

  .kind.stop {
    font-weight: var(--weight-medium);
  }

  .running .kind,
  .running .text {
    color: var(--agent);
  }

  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .full {
    display: block;
    color: var(--text);
  }

  .text a {
    margin-left: var(--s-2);
    color: var(--text);
  }

  .stats {
    margin-left: var(--s-2);
    color: var(--text-2);
  }

  .mono {
    font-family: var(--font-code);
  }

  .more {
    margin-left: var(--s-2);
    color: var(--text);
    text-decoration: underline;
    font: inherit;
  }
</style>
