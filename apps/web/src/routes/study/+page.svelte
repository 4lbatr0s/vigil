<script lang="ts">
import { noteHref, NOTES_PATH } from "$lib/links";
  import ExamDates from "$lib/components/ExamDates.svelte";
  import { Button, Cluster, Kbd, Page, Row, Stack, Switch, Textarea } from "$lib/ui";
  import { onMount, tick } from "svelte";
  import { page } from "$app/state";
  import { answerStudyCard, getDecks, getDueCards, getStuckCards, getStudyForecast, getStudyHistory, getStudyStats, undoStudyAnswer, type Answer, type DayCount, type DeckStats, type ForecastDay, type StuckCard, type StudyStats } from "$lib/api";
  import { lintCard } from "@vigil/shared";
  import { refreshStudyDue } from "$lib/study-state";
  import { ANSWER_KEYS, answer, current, isFinished, remaining, reveal, startSession, type Session } from "$lib/study-session";

  /** Forgotten this many times after being learned: time to rewrite the card, not drill it again. */
  const STUCK_LAPSES = 6;
  let session = $state<Session | null>(null);
  let stats = $state<StudyStats | null>(null);
  let decks = $state<DeckStats[]>([]);
  let history = $state<DayCount[]>([]);
  let forecast = $state<ForecastDay[]>([]);
  let stuck = $state<StuckCard[]>([]);
  const forecastPeak = $derived(Math.max(1, ...forecast.map((d) => d.count)));
  const forecastTotal = $derived(forecast.reduce((n, d) => n + d.count, 0));
  const peak = $derived(Math.max(1, ...history.map((d) => d.count)));
  const weekTotal = $derived(history.slice(-7).reduce((n, d) => n + d.count, 0));
  let loadError = $state("");
  let saveError = $state("");
  let typed = $state("");
  /** The sitting as it was before the last answer, so one answer can be taken back. */
  let before = $state<Session | null>(null);
  let lastAnswer = $state<Answer | null>(null);
  let typeFirst = $state(true);
  let box = $state<HTMLTextAreaElement | undefined>();
  let stage = $state<HTMLDivElement | undefined>();

  const noteId = $derived(page.url.searchParams.get("note"));
  const card = $derived(session ? current(session) : null);
  const finished = $derived(session ? isFinished(session) : false);
  const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const inUndoBox = $derived(typeFirst && !!session && !session.revealed);

  async function load(): Promise<void> {
    loadError = "";
    try {
      const [cards, st, d, h, f, sk] = await Promise.all([getDueCards(noteId ? { note: noteId } : {}), getStudyStats(noteId ?? undefined), getDecks().catch(() => [] as DeckStats[]), getStudyHistory().catch(() => [] as DayCount[]), getStudyForecast().catch(() => [] as ForecastDay[]), getStuckCards().catch(() => [] as StuckCard[])]);
      session = startSession(cards);
      stats = st;
      decks = d;
      history = h;
      forecast = f;
      stuck = sk;
      await tick();
      focusCard();
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not load your cards";
    }
  }

  onMount(() => void load());

  function focusCard(): void {
    if (typeFirst && !session?.revealed) box?.focus();
    else stage?.focus();
  }

  async function show(): Promise<void> {
    if (!session) return;
    session = reveal(session);
    await tick();
    stage?.focus();
  }

  async function give(a: Answer): Promise<void> {
    if (!session || !card || !session.revealed) return;
    const id = card.id;
    saveError = "";
    const was = session;
    session = answer(session, a);
    typed = "";
    try {
      await answerStudyCard(id, a);
      before = was;
      lastAnswer = a;
      void refreshStudyDue();
    } catch (err) {
      // Keep the person where they were: nothing is lost, they can try the answer again.
      session = was;
      saveError = err instanceof Error ? err.message : "That answer was not saved";
    }
    await tick();
    focusCard();
  }

  /** Takes back the last answer on the server and returns to that card, answer showing. */
  async function undo(): Promise<void> {
    if (!before) return;
    saveError = "";
    try {
      await undoStudyAnswer();
      session = { ...before, revealed: true };
      before = null;
      lastAnswer = null;
      void refreshStudyDue();
      await tick();
      stage?.focus();
    } catch (err) {
      saveError = err instanceof Error ? err.message : "Could not take that back";
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!session || event.altKey) return;
    const inBox = event.target instanceof HTMLTextAreaElement;
    // Undo: Cmd/Ctrl+Z while the answer box is empty, or plain Z when you are not typing in it.
    const asksUndo = event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey ? (!inBox || typed === "") && !event.shiftKey : !inBox);
    if (asksUndo && before) {
      event.preventDefault();
      void undo();
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    if (!session.revealed) {
      // Enter in the answer box (or Space on the card) shows the answer; Shift+Enter makes a new line.
      if ((event.key === "Enter" && !event.shiftKey) || (event.key === " " && !inBox)) {
        event.preventDefault();
        void show();
      }
      return;
    }
    const a = ANSWER_KEYS[event.key];
    if (a) {
      event.preventDefault();
      void give(a);
    }
  }

  const labels: { key: string; answer: Answer; text: string; hint: string }[] = [
    { key: "1", answer: "again", text: "Again", hint: "I didn't know it" },
    { key: "2", answer: "hard", text: "Hard", hint: "with effort" },
    { key: "3", answer: "good", text: "Good", hint: "I knew it" },
    { key: "4", answer: "easy", text: "Easy", hint: "right away" },
  ];
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>Study · Vigil</title></svelte:head>

<Page title="Study">
  {#snippet actions()}
    {#if session && !finished}<span class="progress" aria-live="polite">{remaining(session)} left</span>{/if}
    <Switch label="Type my answer first" bind:checked={typeFirst} />
  {/snippet}

  <Stack gap={8}>
    {#if loadError}
      <p class="error" role="alert">{loadError}</p>
    {:else if !session}
      <p class="muted">Getting your cards…</p>
    {:else if finished}
      <section class="done">
        <h2>{session.done > 0 ? "That's it for now." : "Nothing to study right now."}</h2>
        {#if session.done > 0}
          <p>
            You went through {session.done} {session.done === 1 ? "card" : "cards"}.
            {session.answers.good + session.answers.easy} felt solid{session.answers.again > 0 ? `, ${session.answers.again} to see again soon` : ""}.
          </p>
        {:else if stats && stats.total === 0}
          <p>No cards yet. In any note, write <code>Question :: Answer</code>, or put <code>{"{{"}</code>double braces<code>{"}}"}</code> around the part to hide.</p>
        {:else}
          <p class="muted">No cards are due.</p>
        {/if}
        {#if before && lastAnswer}<p class="muted">Last answer: {lastAnswer}. <button type="button" class="linkbtn" onclick={() => void undo()}>Take it back</button> <Kbd keys={inUndoBox ? `${modKey} Z` : "Z"} /></p>{/if}
        <div><Button href={NOTES_PATH}>Back to your notes</Button></div>
      </section>
    {:else if card}
      <div class="stage" tabindex="-1" bind:this={stage}>
        <p class="kind">{card.kind === "cloze" ? "Fill in the blank" : "Question"}{card.isNew ? " · new" : ""}</p>
        {#if card.context}<p class="context">{card.context}</p>{/if}
        <p class="front">{card.front}</p>
        {#if !session.revealed}
          {#if typeFirst}
            <label class="answer-box">
              <span class="muted">Say it in your own words first</span>
              <Textarea bind:el={box} rows={3} bind:value={typed} placeholder="Your answer (optional)" />
            </label>
          {/if}
          <div><Button variant="primary" onclick={() => void show()}>Show the answer <Kbd keys={typeFirst ? "Enter" : "Space"} /></Button></div>
        {:else}
          {#if typed.trim() !== ""}<p class="yours"><span class="muted">You wrote</span> {typed}</p>{/if}
          <p class="back">{card.back}</p>
          <div class="answers" role="group" aria-label="How did that go?">
            {#each labels as l (l.key)}
              <Button onclick={() => void give(l.answer)}>{l.text} <Kbd keys={l.key} /></Button>
            {/each}
          </div>
          <p class="muted">{labels.map((l) => `${l.key} ${l.hint}`).join(" · ")}</p>
        {/if}
        {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
        {#if before && lastAnswer}<p class="muted">Answered {lastAnswer}. <button type="button" class="linkbtn" onclick={() => void undo()}>Take it back</button> <Kbd keys={inUndoBox ? `${modKey} Z` : "Z"} /></p>{/if}
        {#if session.revealed && card.lapses >= STUCK_LAPSES}
          <aside class="stuck" aria-label="This card keeps slipping">
            <p><strong>This one keeps slipping.</strong> You have forgotten it {card.lapses} times. A card that is hard to hold usually needs rewording or splitting.</p>
            {#each lintCard(card) as h (h.code)}<p class="muted">{h.message}</p>{/each}
            <p><a href={noteHref(card.noteId)}>Open the note to rewrite it</a></p>
          </aside>
        {/if}
        <p class="source"><a href={noteHref(card.noteId)}>From {card.noteId}</a></p>
      </div>
    {/if}

    <Cluster gap={2}>
      <Button variant="ghost" size="sm" href={`/api/study/export${noteId ? `?note=${encodeURIComponent(noteId)}` : ""}`} download>Download cards for Anki</Button>
      <Button variant="ghost" size="sm" href="/import">Import cards</Button>
    </Cluster>

    <Cluster gap={2}>
      <Button variant="ghost" size="sm" href="/recall">Recall check</Button>
      <Button variant="ghost" size="sm" href="/outline">Outline a text</Button>
      <Button variant="ghost" size="sm" href="/gap">Gap check</Button>
    </Cluster>

    <ExamDates initialNote={noteId} onchange={() => void refreshStudyDue()} />

    {#if history.some((d) => d.count > 0)}
      <section aria-labelledby="recent">
        <h2 id="recent">Last 14 days</h2>
        <ol class="bars" aria-label={`${weekTotal} answers in the last 7 days`}>
          {#each history as d (d.day)}
            <li title={`${d.day}: ${d.count} ${d.count === 1 ? "answer" : "answers"}`}><span style:height="{Math.max(d.count ? 8 : 2, Math.round((d.count / peak) * 100))}%" class:zero={d.count === 0}></span></li>
          {/each}
        </ol>
        <p class="muted">{weekTotal} {weekTotal === 1 ? "answer" : "answers"} this week</p>
      </section>
    {/if}

    {#if stuck.length > 0}
      <section aria-labelledby="slipping">
        <h2 id="slipping">Keeps slipping</h2>
        <p class="muted">Rewording or splitting these usually works better than more drilling.</p>
        <div class="list">
          {#each stuck as c (c.id)}
            <Row title={c.front} meta={`forgotten ${c.lapses} times`} href={noteHref(c.noteId)} />
          {/each}
        </div>
      </section>
    {/if}

    {#if forecastTotal > 0}
      <section aria-labelledby="coming">
        <h2 id="coming">Coming up</h2>
        <ol class="bars" aria-label={`${forecastTotal} reviews due in the next 14 days`}>
          {#each forecast as d (d.day)}
            <li title={`${d.day}: ${d.count} ${d.count === 1 ? "review" : "reviews"}`}><span style:height="{Math.max(d.count ? 8 : 2, Math.round((d.count / forecastPeak) * 100))}%" class:zero={d.count === 0}></span></li>
          {/each}
        </ol>
        <p class="muted">{forecastTotal} {forecastTotal === 1 ? "review" : "reviews"} over the next 14 days. Today is the left bar.</p>
      </section>
    {/if}

    {#if decks.length > 0}
      <section aria-labelledby="by-note">
        <h2 id="by-note">By note</h2>
        <div class="list">
          {#each decks as d (d.noteId)}
            <Row
              title={d.noteId}
              meta={`${d.cards} ${d.cards === 1 ? "card" : "cards"}`}
              snippet={`${d.due + d.new > 0 ? `${d.due + d.new} to study` : "all done"} · ${d.recall === null ? "not enough answers for recall yet" : `recall ${d.recall}%`}`}
              href={`/study?note=${encodeURIComponent(d.noteId)}`}
              data-sveltekit-reload=""
            />
          {/each}
        </div>
      </section>
    {/if}
  </Stack>
</Page>

<style>
  h2 {
    margin-bottom: var(--s-2);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  p {
    margin: 0;
  }

  .progress,
  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-6) 0;
    outline: none;
  }

  .kind {
    color: var(--text-3);
    font: var(--weight-medium) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .context {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .front {
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-prose);
    letter-spacing: var(--type-title-tracking);
  }

  .back {
    padding-top: var(--s-4);
    box-shadow: 0 -1px 0 var(--line-soft);
    font: var(--weight-regular) var(--type-heading-size) / var(--type-heading-lh) var(--font-prose);
  }

  .yours {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .answer-box {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .answers {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s-2);
  }

  .linkbtn {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .stuck {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .source {
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .source a {
    color: var(--text-3);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: var(--s-1);
    height: 48px;
    margin: 0 0 var(--s-2);
    padding: 0;
    list-style: none;
  }

  .bars li {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }

  .bars span {
    display: block;
    width: 100%;
    border-radius: var(--r-control);
    background: var(--text-3);
  }

  .bars span.zero {
    background: var(--fill-selected);
  }

  .done {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-8) 0;
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-ui);
  }

  .done h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-ui);
    letter-spacing: var(--type-title-tracking);
  }

  code {
    padding: 0 var(--s-1);
    border-radius: var(--r-control);
    background: var(--fill-selected);
    font: var(--weight-regular) var(--type-ui-size) / 1 var(--font-code);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  @media (max-width: 639px) {
    .answers {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
