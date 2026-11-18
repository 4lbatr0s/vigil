<script lang="ts">
  import Illustration from "$lib/components/Illustration.svelte";
  import { onMount } from "svelte";
  import type { Run } from "@vigil/shared";
  import { ApiError, captureLine, getStuckCards, createFromTemplate, getGoals, getRecall, getStudyStats, listAgents, listApprovals, listNotes, listRuns, putAgent, runAgent, undoRun, type ApprovalItem, type Goal, type RecallItem, type StuckCard, type StudyStats } from "$lib/api";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { refreshOnLive } from "$lib/live";
  import { startHere } from "$lib/focus";
  import { goalLine, nextGoal } from "$lib/goals";
  import { relativeTime } from "$lib/note-list";
  import { canUndo } from "$lib/run-log";
  import { statusDot } from "$lib/schedule";
  import { lastVisit, markSeen, refreshUnseen, sinceVisit } from "$lib/today";

  let runs = $state<Run[]>([]);
  let pending = $state<ApprovalItem[]>([]);
  let titles = $state(new Map<string, string>());
  let study = $state<StudyStats | null>(null);
  let goals = $state<Goal[]>([]);
  let recallDue = $state<RecallItem[]>([]);
  let stuck = $state<StuckCard[]>([]);
  const exam = $derived(nextGoal(goals));
  const focus = $derived(startHere({ goals, recallDue, studyDue: study?.due ?? 0, newOffered: study?.newOffered ?? 0, stuck, pendingApprovals: pending.length, titles }));
  let since = $state<string | null>(null);
  let loading = $state(true);
  let loadError = $state("");
  let errors = $state(new Map<string, string>());
  let asking = $state<string | null>(null);
  let captured = $state("");
  let captureNote = $state("");
  let capturing = $state(false);
  let filing = $state(false);

  const items = $derived(sinceVisit(runs, since));
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Still up?" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function load(): Promise<void> {
    try {
      const [r, a, notes, st] = await Promise.all([listRuns({ limit: 100 }), listApprovals("pending"), listNotes(), getStudyStats()]);
      goals = await getGoals().catch(() => [] as Goal[]);
      stuck = await getStuckCards().catch(() => [] as StuckCard[]);
      recallDue = (await getRecall().catch(() => [] as RecallItem[])).filter((r) => r.isDue);
      runs = r;
      pending = a;
      study = st;
      titles = new Map(notes.map((n) => [n.id, n.title]));
      loadError = "";
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not load";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    since = lastVisit();
    void load();
    return refreshOnLive(load, ["run", "approval"], 8000);
  });

  async function addCapture(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const text = captured.trim();
    if (text === "" || capturing) return;
    capturing = true;
    try {
      await captureLine(text);
      captured = "";
      captureNote = "Added to your Inbox note.";
    } catch (err) {
      captureNote = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not add it";
    } finally {
      capturing = false;
    }
  }

  /** Starts the Inbox triager once. Its writes wait in "Needs you" for your yes (the template is strict). */
  async function fileInbox(): Promise<void> {
    if (filing) return;
    filing = true;
    try {
      let agent = (await listAgents()).find((a) => a.name === "inbox-triager");
      if (!agent) agent = await createFromTemplate("inbox-triager");
      if (!agent.enabled) agent = await putAgent({ ...agent, enabled: true });
      await runAgent(agent.name);
      captureNote = "Filing started. What it proposes will wait under “Needs you” for your yes.";
    } catch (err) {
      captureNote = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start filing";
    } finally {
      filing = false;
    }
  }

  function seen(): void {
    markSeen();
    since = lastVisit();
    void refreshUnseen();
  }

  async function undo(run: Run): Promise<void> {
    asking = null;
    errors.delete(run.id);
    try {
      await undoRun(run.id);
      await load();
    } catch (err) {
      errors.set(run.id, err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not undo");
      errors = new Map(errors);
    }
  }

  const label = (r: Run): string => (r.undone ? "undone" : r.status === "waiting-approval" ? "waiting for you" : r.status);
</script>

<div class="page">
  <header class="head">
    <div>
      <h1>{greeting}</h1>
      <p class="lede">What your agents did{since ? " since you last looked" : " in the last day"}.</p>
    </div>
    {#if items.length > 0}<button type="button" class="btn" onclick={seen}>Mark all as seen</button>{/if}
  </header>

  {#if loadError}
    <p class="error">{loadError}</p>
  {:else if loading}
    <p class="muted">Loading…</p>
  {:else}
    {#if focus.length > 0}
      <section aria-labelledby="first">
        <h2 id="first">Start here</h2>
        <ul class="first">
          {#each focus as f (f.key)}
            <li><span>{f.text}</span> <a class="btn" href={f.href}>{f.label}</a></li>
          {/each}
        </ul>
      </section>
    {/if}
    <section aria-labelledby="capture">
      <h2 id="capture">Capture</h2>
      <form class="capture" onsubmit={addCapture}>
        <input type="text" bind:value={captured} aria-label="Quick capture" placeholder="A thought, a task, a question…" maxlength="2000" />
        <button type="submit" class="btn" disabled={capturing || captured.trim() === ""}>Add to Inbox</button>
        <button type="button" class="btn" disabled={filing} onclick={() => void fileInbox()} title="An agent suggests which note each line belongs in; you approve each one">File my inbox</button>
      </form>
      <p class="muted" aria-live="polite">{captureNote}</p>
    </section>
    {#if study && study.due + study.newOffered > 0}
      <section aria-labelledby="study">
        <h2 id="study">Study</h2>
        <div class="card">
          <div class="line">
            <strong>{study.due > 0 ? `${study.due} ${study.due === 1 ? "card is" : "cards are"} ready to review` : `${study.newOffered} new ${study.newOffered === 1 ? "card" : "cards"} to learn`}</strong>
            {#if study.reviewedToday > 0}<span class="state">{study.reviewedToday} done today</span>{/if}
          </div>
          {#if exam}<p>{goalLine(exam)}</p>{/if}
          <p class="muted">A few minutes now is worth more than an hour of rereading later.</p>
          <div class="actions"><a class="btn primary" href="/study">Start studying</a></div>
        </div>
      </section>
    {/if}

    {#if recallDue.length > 0}
      <section aria-labelledby="recall">
        <h2 id="recall">Recall</h2>
        <div class="card">
          <p><strong>{recallDue.length === 1 ? "A note is" : `${recallDue.length} notes are`} ready to recall.</strong> Write what you remember, then see what you missed.</p>
          <div class="actions">
            {#each recallDue.slice(0, 3) as r (r.noteId)}
              <a class="btn" href={`/recall?note=${encodeURIComponent(r.noteId)}`} data-sveltekit-reload>{titles.get(r.noteId) ?? r.noteId}</a>
            {/each}
          </div>
        </div>
      </section>
    {/if}

    {#if pending.length > 0}
      <section aria-labelledby="needs">
        <h2 id="needs">Needs you</h2>
        <ul class="cards">
          {#each pending as p (p.id)}
            <li class="card">
              <div class="line">
                <span class="dot amber" aria-hidden="true"></span>
                <strong>{p.agent ?? "An agent"}</strong> wants to change
                <a href={`/?note=${encodeURIComponent(p.noteId)}`}>{p.title || p.noteId}</a>
                <span class="when">{relativeTime(p.createdAt)}</span>
              </div>
              <div class="actions"><a class="btn primary" href="/approvals">Review</a></div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="ran">
      <h2 id="ran">Since your last visit</h2>
      {#if items.length === 0}
        <div class="empty">
          <Illustration kind="calm" />
          <p>All quiet.</p>
          <p class="muted">Your agents have not done anything since you last looked. <a href="/agents">See your agents</a>.</p>
        </div>
      {:else}
        <ul class="cards">
          {#each items as r (r.id)}
            <li class="card">
              <div class="line">
                <StatusDot state={r.undone ? "idle" : statusDot({ enabled: true }, r)} />
                <strong>{r.agent}</strong>
                <span class="state">{label(r)}</span>
                <span class="when" title={r.startedAt}>{relativeTime(r.startedAt)}</span>
              </div>
              {#if r.touched.length > 0}
                <p class="wrote">
                  Changed
                  {#each r.touched as id, i (id)}{i > 0 ? ", " : " "}<a href={`/?note=${encodeURIComponent(id)}`}>{titles.get(id) ?? id}</a>{/each}
                </p>
              {:else if r.error}
                <p class="wrote err">{r.error}</p>
              {:else}
                <p class="wrote muted">No notes changed.</p>
              {/if}
              <div class="actions">
                <a class="btn" href={`/runs/${encodeURIComponent(r.id)}`}>View run</a>
                {#if canUndo(r)}
                  {#if asking === r.id}
                    <span class="ask" role="alertdialog" aria-label="Confirm undo">
                      Restore what this run changed?
                      <button type="button" class="btn danger" onclick={() => void undo(r)}>Undo</button>
                      <button type="button" class="btn" onclick={() => (asking = null)}>Keep</button>
                    </span>
                  {:else}
                    <button type="button" class="btn" onclick={() => (asking = r.id)}>Undo this run</button>
                  {/if}
                {/if}
              </div>
              {#if errors.get(r.id)}<p class="error" role="alert">{errors.get(r.id)}</p>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .first {
    display: grid;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
  }
  .first li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  .capture {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .capture input {
    flex: 1;
    min-width: 12rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  .page {
    max-width: 760px;
    margin-inline: auto;
    padding: var(--space-6);
    display: grid;
    gap: var(--space-6);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h1);
    font-weight: 600;
  }

  h2 {
    margin-bottom: var(--space-3);
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-muted);
    font-weight: 500;
  }

  .lede,
  .muted {
    color: var(--ink-muted);
  }

  .cards {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .dot {
    align-self: center;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .dot.amber {
    background: var(--amber);
  }

  .state,
  .when {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }

  .when {
    margin-left: auto;
  }

  .wrote {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
  }

  .wrote.err,
  .error {
    color: var(--err-ink);
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .ask {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .btn {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    color: var(--ink);
    text-decoration: none;
    font-size: var(--text-label);
  }

  .btn:hover {
    background: var(--surface-hover);
  }

  .btn.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }

  .btn.danger {
    border-color: var(--err);
    color: var(--err-ink);
  }

  .empty {
    padding: var(--space-6) 0;
    font-size: var(--text-ui);
    text-align: center;
  }
</style>
