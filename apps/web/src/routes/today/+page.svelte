<script lang="ts">
  import Illustration from "$lib/components/Illustration.svelte";
  import { onMount } from "svelte";
  import type { Run } from "@vigil/shared";
  import { ApiError, getGoals, getStudyStats, listApprovals, listNotes, listRuns, undoRun, type ApprovalItem, type Goal, type StudyStats } from "$lib/api";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { refreshOnLive } from "$lib/live";
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
  const exam = $derived(nextGoal(goals));
  let since = $state<string | null>(null);
  let loading = $state(true);
  let loadError = $state("");
  let errors = $state(new Map<string, string>());
  let asking = $state<string | null>(null);

  const items = $derived(sinceVisit(runs, since));
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Still up?" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function load(): Promise<void> {
    try {
      const [r, a, notes, st] = await Promise.all([listRuns({ limit: 100 }), listApprovals("pending"), listNotes(), getStudyStats()]);
      goals = await getGoals().catch(() => [] as Goal[]);
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
    {#if study && study.due + study.new > 0}
      <section aria-labelledby="study">
        <h2 id="study">Study</h2>
        <div class="card">
          <div class="line">
            <strong>{study.due > 0 ? `${study.due} ${study.due === 1 ? "card is" : "cards are"} ready to review` : `${Math.min(study.new, 10)} new ${study.new === 1 ? "card" : "cards"} to learn`}</strong>
            {#if study.reviewedToday > 0}<span class="state">{study.reviewedToday} done today</span>{/if}
          </div>
          {#if exam}<p>{goalLine(exam)}</p>{/if}
          <p class="muted">A few minutes now is worth more than an hour of rereading later.</p>
          <div class="actions"><a class="btn primary" href="/study">Start studying</a></div>
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
  .page {
    max-width: 760px;
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
  }
</style>
