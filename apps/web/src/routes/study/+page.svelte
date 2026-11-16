<script lang="ts">
  import Illustration from "$lib/components/Illustration.svelte";
  import { onMount, tick } from "svelte";
  import { page } from "$app/state";
  import { answerStudyCard, getDecks, getDueCards, getStudyStats, type Answer, type DeckStats, type StudyStats } from "$lib/api";
  import { refreshStudyDue } from "$lib/study-state";
  import { ANSWER_KEYS, answer, current, isFinished, remaining, reveal, startSession, type Session } from "$lib/study-session";

  let session = $state<Session | null>(null);
  let stats = $state<StudyStats | null>(null);
  let decks = $state<DeckStats[]>([]);
  let loadError = $state("");
  let saveError = $state("");
  let typed = $state("");
  let typeFirst = $state(true);
  let box = $state<HTMLTextAreaElement | undefined>();
  let stage = $state<HTMLDivElement | undefined>();

  const noteId = $derived(page.url.searchParams.get("note"));
  const card = $derived(session ? current(session) : null);
  const finished = $derived(session ? isFinished(session) : false);

  async function load(): Promise<void> {
    loadError = "";
    try {
      const [cards, st, d] = await Promise.all([getDueCards(noteId ? { note: noteId } : {}), getStudyStats(noteId ?? undefined), getDecks().catch(() => [] as DeckStats[])]);
      session = startSession(cards);
      stats = st;
      decks = d;
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
    const before = session;
    session = answer(session, a);
    typed = "";
    try {
      await answerStudyCard(id, a);
      void refreshStudyDue();
    } catch (err) {
      // Keep the person where they were: nothing is lost, they can try the answer again.
      session = before;
      saveError = err instanceof Error ? err.message : "That answer was not saved";
    }
    await tick();
    focusCard();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!session || event.metaKey || event.ctrlKey || event.altKey) return;
    const inBox = event.target instanceof HTMLTextAreaElement;
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
    { key: "2", answer: "hard", text: "Hard", hint: "With effort" },
    { key: "3", answer: "good", text: "Good", hint: "I knew it" },
    { key: "4", answer: "easy", text: "Easy", hint: "Right away" },
  ];
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>Study · Vigil</title></svelte:head>

<div class="page">
  <header class="head">
    <h1>Study</h1>
    {#if session && !finished}<p class="progress" aria-live="polite">{remaining(session)} left</p>{/if}
    <label class="toggle"><input type="checkbox" bind:checked={typeFirst} /> Type my answer first</label>
  </header>

  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !session}
    <p class="muted">Getting your cards…</p>
  {:else if finished}
    <div class="done">
      <Illustration kind="cards" />
      <h2>{session.done > 0 ? "That's it for now." : "Nothing to study right now."}</h2>
      {#if session.done > 0}
        <p>
          You went through {session.done} {session.done === 1 ? "card" : "cards"}.
          {session.answers.good + session.answers.easy} felt solid{session.answers.again > 0 ? `, ${session.answers.again} to see again soon` : ""}.
        </p>
        <p class="muted">Come back tomorrow: spacing the reviews out is what makes them stick.</p>
      {:else if stats && stats.total === 0}
        <p>You have no cards yet. Write one in any note as <code>Question :: Answer</code>, or put <code>{"{{"}</code>double braces<code>{"}}"}</code> around the part to hide.</p>
      {:else}
        <p class="muted">Your cards are resting. They will come back when it is time.</p>
      {/if}
      <p><a class="btn" href="/">Back to your notes</a></p>
    </div>
  {:else if card}
    <div class="stage" tabindex="-1" bind:this={stage}>
      <p class="kind">{card.kind === "cloze" ? "Fill in the blank" : "Question"}{card.isNew ? " · new" : ""}</p>
      <p class="front">{card.front}</p>
      {#if !session.revealed}
        {#if typeFirst}
          <label class="answer-box">
            <span class="muted">Say it in your own words first</span>
            <textarea bind:this={box} rows="3" bind:value={typed} placeholder="Your answer (optional)"></textarea>
          </label>
        {/if}
        <button type="button" class="btn primary" onclick={() => void show()}>Show the answer <kbd>{typeFirst ? "Enter" : "Space"}</kbd></button>
      {:else}
        {#if typed.trim() !== ""}<p class="yours"><span class="muted">You wrote</span> {typed}</p>{/if}
        <p class="back">{card.back}</p>
        <div class="answers" role="group" aria-label="How did that go?">
          {#each labels as l (l.key)}
            <button type="button" class="btn answer {l.answer}" onclick={() => void give(l.answer)}>
              <span class="t">{l.text}</span>
              <span class="h">{l.hint}</span>
              <kbd>{l.key}</kbd>
            </button>
          {/each}
        </div>
      {/if}
      {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
      <p class="source"><a href={`/?note=${encodeURIComponent(card.noteId)}`}>From {card.noteId}</a></p>
    </div>
  {/if}

  {#if decks.length > 0}
    <section class="decks" aria-labelledby="by-note">
      <h2 id="by-note">By note</h2>
      <ul>
        {#each decks as d (d.noteId)}
          <li>
            <a href={`/study?note=${encodeURIComponent(d.noteId)}`} data-sveltekit-reload>{d.noteId}</a>
            <span class="count">{d.cards} {d.cards === 1 ? "card" : "cards"}</span>
            <span class="count">{d.due + d.new > 0 ? `${d.due + d.new} to study` : "all done"}</span>
            <span class="count" title="Share of your answers that were not Again">{d.recall === null ? "recall: not enough answers yet" : `recall ${d.recall}%`}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .page {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-6);
    display: grid;
    gap: var(--space-6);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h1);
    font-weight: 600;
    margin-right: auto;
  }

  .progress,
  .toggle,
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }

  .stage {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-8);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    outline: none;
  }

  .kind {
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .front {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    line-height: 1.3;
  }

  .back {
    padding-top: var(--space-4);
    border-top: 1px solid var(--hairline);
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    line-height: 1.4;
  }

  .yours {
    font-size: var(--text-label);
    color: var(--ink-muted);
    font-style: italic;
  }

  .answer-box {
    display: grid;
    gap: var(--space-1);
  }

  textarea {
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    font: inherit;
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    color: var(--ink);
    resize: vertical;
  }

  .answers {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    color: var(--ink);
    text-decoration: none;
    font-size: var(--text-ui);
  }

  .btn:hover {
    background: var(--surface-hover);
  }

  .btn.primary {
    justify-self: start;
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }

  .btn.primary:hover {
    background: var(--ink);
    opacity: 0.9;
  }

  .answer {
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3) var(--space-2);
    text-align: center;
  }

  .answer .t {
    font-weight: 600;
  }

  .answer .h {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .btn.primary kbd {
    color: var(--bg);
    opacity: 0.7;
  }

  .source {
    font-size: var(--text-label);
  }

  .source a {
    color: var(--ink-muted);
  }

  .decks h2 {
    margin-bottom: var(--space-2);
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    font-weight: 500;
    color: var(--ink-muted);
  }

  .decks ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .decks li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }

  .decks a {
    margin-right: auto;
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    color: var(--ink);
  }

  .count {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .done {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-8) 0;
    font-size: var(--text-prose);
  }

  .done h2 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
  }

  code {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--surface);
    font-size: 0.9em;
  }

  .error {
    color: var(--err-ink);
    font-size: var(--text-label);
  }

  @media (max-width: 639px) {
    .stage {
      padding: var(--space-4);
    }
    .answers {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
