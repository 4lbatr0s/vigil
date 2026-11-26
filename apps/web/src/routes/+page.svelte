<script lang="ts">
  /**
   * Today, the home page (2026-11-26). Top to bottom: capture, today's note, the next things worth doing, what waits for
   * the learner's yes, and what helpers did since the last visit. A section with nothing in it is not shown.
   */
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Badge, Button, Dialog, Input, Page, Row, Stack } from "$lib/ui";
  import { onMount } from "svelte";
  import type { Run } from "@vigil/shared";
  import { ApiError, captureLine, getDecks, type DeckStats, getStuckCards, createFromTemplate, getGoals, getNote, getRecall, getStudyStats, listAgents, listApprovals, listNotes, listRuns, putAgent, runAgent, undoRun, type ApprovalItem, type Goal, type RecallItem, type StuckCard, type StudyStats } from "$lib/api";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { refreshOnLive } from "$lib/live";
  import { startHere } from "$lib/focus";
  import { dailyNote } from "$lib/daily";
  import { goalLine, nextGoal } from "$lib/goals";
  import { dailyHref, noteHref } from "$lib/links";
  import { relativeTime } from "$lib/note-list";
  import { canUndo } from "$lib/run-log";
  import { statusDot } from "$lib/schedule";
  import { dateLine, inboxItems, lastVisit, markSeen, refreshUnseen, sinceVisit } from "$lib/today";

  const INBOX_ID = "inbox";
  /** Focus the capture line on desktop only: on a phone it would open the keyboard on every visit. */
  const finePointer = typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches;
  const today = dailyNote();

  let runs = $state<Run[]>([]);
  let pending = $state<ApprovalItem[]>([]);
  let titles = $state(new Map<string, string>());
  let study = $state<StudyStats | null>(null);
  let goals = $state<Goal[]>([]);
  let recallDue = $state<RecallItem[]>([]);
  let stuck = $state<StuckCard[]>([]);
  let uncarded = $state<{ id: string; title: string }[]>([]);
  let inboxCount = $state(0);
  let todaySnippet = $state<string | null>(null);
  const exam = $derived(nextGoal(goals));
  const toPractice = $derived(study ? study.due + study.newOffered : 0);
  /** The next steps, minus the ones this page already shows as their own section (cards to practise, approvals). */
  const next = $derived(
    startHere({ goals, recallDue, studyDue: study?.due ?? 0, newOffered: study?.newOffered ?? 0, stuck, pendingApprovals: pending.length, uncarded, titles }).filter(
      (f) => f.key !== "cards" && f.key !== "approvals",
    ),
  );
  let since = $state<string | null>(null);
  let loading = $state(true);
  let loadError = $state("");
  let errors = $state(new Map<string, string>());
  let asking = $state<Run | null>(null);
  let askOpen = $state(false);
  let captured = $state("");
  let captureNote = $state("");
  let capturing = $state(false);
  let filing = $state(false);

  const items = $derived(sinceVisit(runs, since));
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Still up?" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function loadInbox(): Promise<void> {
    inboxCount = await getNote(INBOX_ID)
      .then((n) => inboxItems(n.body))
      .catch(() => 0);
  }

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
      const daily = notes.find((n) => n.id === today.id);
      todaySnippet = daily ? (daily.snippet ?? "") : null;
      // Notes written by you in the last three days that hold no cards (source notes are reading material, not for cards).
      const withCards = new Set((await getDecks().catch(() => [] as DeckStats[])).filter((d) => d.cards > 0).map((d) => d.noteId));
      const cutoff = Date.now() - 3 * 86_400_000;
      uncarded = notes
        .filter((n) => n.author === "human" && Date.parse(n.updatedAt) >= cutoff && !withCards.has(n.id) && !n.tags.includes("source") && (n.snippet ?? "").length > 60)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((n) => ({ id: n.id, title: n.title }));
      await loadInbox();
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
      captureNote = "Added to your inbox.";
      await loadInbox();
    } catch (err) {
      captureNote = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not add it";
    } finally {
      capturing = false;
    }
  }

  /** Starts the Inbox helper once. Its writes wait under "Needs you" for your yes (the template is strict). */
  async function sortInbox(): Promise<void> {
    if (filing) return;
    filing = true;
    try {
      let agent = (await listAgents()).find((a) => a.name === "inbox-triager");
      if (!agent) agent = await createFromTemplate("inbox-triager");
      if (!agent.enabled) agent = await putAgent({ ...agent, enabled: true });
      await runAgent(agent.name);
      captureNote = "Sorting started. What it suggests will wait under “Needs you”.";
    } catch (err) {
      captureNote = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start sorting";
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
    askOpen = false;
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

<svelte:head><title>Today · Vigil</title></svelte:head>

<Page title={greeting} width="prose">
  {#snippet actions()}
    {#if items.length > 0}<Button variant="ghost" onclick={seen}>Mark all as seen</Button>{/if}
  {/snippet}

  <p class="date">{dateLine()}</p>

  <form class="capture" onsubmit={addCapture}>
    <!-- svelte-ignore a11y_autofocus -->
    <Input bind:value={captured} aria-label="Quick capture" placeholder="What is on your mind?" maxlength={2000} autofocus={finePointer} />
    <Button type="submit" disabled={capturing || captured.trim() === ""}>Add</Button>
  </form>
  <p class="hint" aria-live="polite">
    {#if captureNote}{captureNote}{:else if inboxCount > 0}<a href={noteHref(INBOX_ID)}>{inboxCount} in your inbox</a>{:else}Enter adds it to your inbox. Sort it later.{/if}
    {#if inboxCount > 0}<Button variant="ghost" size="sm" disabled={filing} onclick={() => void sortInbox()}>Sort my inbox</Button>{/if}
  </p>

  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if loading}
    <p class="muted">Loading…</p>
  {:else}
    <Stack gap={8}>
      <section aria-labelledby="daily">
        <h2 id="daily">Today's note</h2>
        {#if todaySnippet}
          <a class="daily" href={dailyHref(today.id)}>{todaySnippet}</a>
        {:else}
          <p class="muted">A page for today: what you learned, what you want to ask.</p>
        {/if}
        <div class="act"><Button href={dailyHref(today.id)}>{todaySnippet === null ? "Start today's note" : "Keep writing"}</Button></div>
      </section>

      {#if toPractice > 0}
        <section aria-labelledby="practice">
          <h2 id="practice">Practice</h2>
          {#if exam}<p class="muted">{goalLine(exam)}</p>{/if}
          <div class="act">
            <Button variant="primary" href="/study">Practice {toPractice} {toPractice === 1 ? "card" : "cards"}</Button>
            {#if study && study.reviewedToday > 0}<span class="muted">{study.reviewedToday} done today</span>{/if}
          </div>
        </section>
      {:else if study && study.reviewedToday > 0}
        <section aria-labelledby="practice">
          <h2 id="practice">Practice</h2>
          <p class="muted">Done for today: {study.reviewedToday} {study.reviewedToday === 1 ? "card" : "cards"} reviewed.</p>
        </section>
      {/if}

      {#if next.length > 0}
        <section aria-labelledby="next">
          <h2 id="next">Worth doing next</h2>
          <div class="list">
            {#each next as f (f.key)}
              <Row title={f.text} href={f.href}>
                {#snippet trail()}<span class="go">{f.label}<ChevronRight size={14} strokeWidth={1.5} /></span>{/snippet}
              </Row>
            {/each}
          </div>
        </section>
      {/if}

      {#if pending.length > 0}
        <section aria-labelledby="needs">
          <h2 id="needs">Needs you</h2>
          <div class="list">
            {#each pending as p (p.id)}
              <Row title={`${p.agent ?? "A helper"} wants to change ${p.title || p.noteId}`} meta={relativeTime(p.createdAt)} href="/approvals">
                {#snippet lead()}<span class="agent-dot" aria-hidden="true"></span>{/snippet}
                {#snippet trail()}<Badge tone="agent">Review</Badge>{/snippet}
              </Row>
            {/each}
          </div>
        </section>
      {/if}

      {#if items.length > 0}
        <section aria-labelledby="ran">
          <h2 id="ran">Since your last visit</h2>
          <div class="list">
            {#each items as r (r.id)}
              <div class="item">
                <Row
                  title={r.agent}
                  meta={relativeTime(r.startedAt)}
                  snippet={r.touched.length > 0 ? `${label(r)}. Changed ${r.touched.map((id) => titles.get(id) ?? id).join(", ")}` : r.error ? `${label(r)}. ${r.error}` : `${label(r)}. No notes changed.`}
                  href={`/runs/${encodeURIComponent(r.id)}`}
                >
                  {#snippet lead()}<StatusDot state={r.undone ? "idle" : statusDot({ enabled: true }, r)} />{/snippet}
                </Row>
                {#if canUndo(r)}
                  <span class="undo"><Button variant="ghost" size="sm" onclick={() => ((asking = r), (askOpen = true))}>Undo</Button></span>
                {/if}
                {#if errors.get(r.id)}<p class="error" role="alert">{errors.get(r.id)}</p>{/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </Stack>
  {/if}
</Page>

<Dialog bind:open={askOpen} title="Undo this run?" description={asking ? `This restores what ${asking.agent} changed.` : ""}>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (askOpen = false)}>Keep changes</Button>
    <Button variant="danger" onclick={() => asking && void undo(asking)}>Undo run</Button>
  {/snippet}
</Dialog>

<style>
  h2 {
    margin-bottom: var(--s-2);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-prose);
  }

  .date {
    margin: calc(var(--s-4) * -1) 0 var(--s-6);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  .muted {
    margin: var(--s-1) 0 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .act {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    margin-top: var(--s-3);
  }

  .capture {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .capture :global(input) {
    flex: 1;
    min-width: 0;
    font-family: var(--font-prose);
    font-size: var(--type-body-size);
  }

  .hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    min-height: var(--control-h);
    margin: var(--s-1) 0 var(--s-8);
    color: var(--text-3);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .hint a {
    color: var(--text-2);
  }

  .daily {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    color: var(--text);
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-prose);
    text-decoration: none;
  }

  .daily:hover {
    color: var(--text-2);
  }

  .go {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-ui-size) / 1 var(--font-ui);
  }

  .agent-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-top: var(--s-1);
    border-radius: var(--r-pill);
    background: var(--agent);
  }

  .item {
    position: relative;
  }

  .undo {
    position: absolute;
    right: var(--s-2);
    bottom: var(--s-1);
    display: none;
  }

  .item:hover .undo,
  .item:focus-within .undo {
    display: inline-flex;
  }

  .error {
    margin: var(--s-1) 0 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
