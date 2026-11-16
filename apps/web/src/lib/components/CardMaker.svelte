<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { ApiError, createFromTemplate, getNote, getNoteCards, getRun, getRunResult, listAgents, putAgent, putNote, startCardProposals } from "$lib/api";
  import { appendCards, isCardLine, proposalsFrom, type Proposal } from "$lib/card-review";

  let { open = $bindable(false), noteId, onsaved }: { open: boolean; noteId: string; onsaved: () => void } = $props();

  type Step = "checking" | "needs-agent" | "running" | "review" | "empty" | "error";
  let step = $state<Step>("checking");
  let proposals = $state<Proposal[]>([]);
  let message = $state("");
  let busy = $state(false);
  let dialogEl = $state<HTMLDivElement | undefined>();
  let opener: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const kept = $derived(proposals.filter((p) => p.keep));
  const invalid = $derived(kept.some((p) => !isCardLine(p.line)));

  $effect(() => {
    if (!open) return;
    opener = document.activeElement;
    cancelled = false;
    step = "checking";
    message = "";
    proposals = [];
    void tick().then(() => dialogEl?.focus());
    void begin();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
  onDestroy(() => clearTimeout(timer));

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function begin(): Promise<void> {
    try {
      const agent = (await listAgents()).find((a) => a.name === "card-maker");
      if (!agent || !agent.enabled) {
        step = "needs-agent";
        return;
      }
      await run();
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start");
    }
  }

  async function turnOn(): Promise<void> {
    busy = true;
    try {
      let agent = (await listAgents()).find((a) => a.name === "card-maker");
      if (!agent) agent = await createFromTemplate("card-maker");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      await run();
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not turn it on");
    } finally {
      busy = false;
    }
  }

  async function run(): Promise<void> {
    step = "running";
    const started = await startCardProposals(noteId);
    await waitFor(started.id);
  }

  async function waitFor(runId: string): Promise<void> {
    if (cancelled) return;
    const { run } = await getRun(runId);
    if (run.status === "running") {
      timer = setTimeout(() => void waitFor(runId).catch((e) => fail(e instanceof Error ? e.message : "Lost track of the run")), 1500);
      return;
    }
    if (run.status !== "succeeded") {
      fail(run.error ?? `The card maker stopped: ${run.status}`);
      return;
    }
    const [{ text }, existing] = await Promise.all([getRunResult(runId), getNoteCards(noteId)]);
    proposals = proposalsFrom(text ?? "", existing);
    step = proposals.length === 0 ? "empty" : "review";
  }

  function close(): void {
    open = false;
    if (opener instanceof HTMLElement) opener.focus();
  }

  async function save(): Promise<void> {
    if (kept.length === 0 || invalid || busy) return;
    busy = true;
    try {
      // The newest saved text, so edits made while the agent worked are not overwritten.
      const note = await getNote(noteId);
      await putNote(noteId, { title: note.title, body: appendCards(note.body, kept.map((p) => p.line)), baseUpdatedAt: note.updatedAt });
      onsaved();
      close();
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <button type="button" class="scrim" aria-label="Close" onclick={close}></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cm-title"
    tabindex="-1"
    bind:this={dialogEl}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }}
  >
    <h2 id="cm-title">Make cards from this note</h2>

    {#if step === "checking" || step === "running"}
      <p class="muted" role="status">{step === "checking" ? "Getting ready…" : "Reading your note and writing cards. This can take a minute."}</p>
    {:else if step === "needs-agent"}
      <p>The Card maker is an agent that reads this note and suggests cards. It can only read: you decide which cards to keep, and nothing is added until you press Save.</p>
      <div class="actions">
        <button type="button" class="btn" onclick={close}>Not now</button>
        <button type="button" class="btn primary" disabled={busy} onclick={() => void turnOn()}>Add and turn on the Card maker</button>
      </div>
    {:else if step === "empty"}
      <p>No cards came back. The note may be too short, or the model could not follow the format. Try again, or write a card yourself as <code>Question :: Answer</code>.</p>
      <div class="actions"><button type="button" class="btn" onclick={close}>Close</button></div>
    {:else if step === "review"}
      <p class="muted">Check each card against your note. Edit the wording, untick what you don't want. Cards you keep are added under “Cards” in this note.</p>
      <ul class="list">
        {#each proposals as p (p.key)}
          <li class:dup={p.duplicate}>
            <label class="keep">
              <input type="checkbox" bind:checked={p.keep} disabled={p.duplicate} aria-label={`Keep this card: ${p.line}`} />
            </label>
            <textarea rows="2" bind:value={p.line} disabled={p.duplicate} class:bad={p.keep && !isCardLine(p.line)} aria-label="Card text"></textarea>
            {#if p.duplicate}<span class="tag">already in this note</span>{/if}
          </li>
        {/each}
      </ul>
      {#if invalid}<p class="error" role="alert">One of the cards is not a single card any more. Use <code>Question :: Answer</code> or put <code>{"{{"}</code>braces<code>{"}}"}</code> around the hidden part.</p>{/if}
      {#if message}<p class="error" role="alert">{message}</p>{/if}
      <div class="actions">
        <button type="button" class="btn" onclick={close}>Cancel</button>
        <button type="button" class="btn primary" disabled={busy || kept.length === 0 || invalid} onclick={() => void save()}>Save {kept.length} {kept.length === 1 ? "card" : "cards"}</button>
      </div>
    {:else}
      <p class="error" role="alert">{message}</p>
      <div class="actions"><button type="button" class="btn" onclick={close}>Close</button></div>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }

  .dialog {
    position: fixed;
    z-index: 41;
    top: 10vh;
    left: 50%;
    display: grid;
    gap: var(--space-3);
    width: min(640px, calc(100vw - 2 * var(--space-4)));
    max-height: 80vh;
    overflow-y: auto;
    transform: translateX(-50%);
    padding: var(--space-6);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
  }

  h2 {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
  }

  .muted {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: var(--space-2);
  }

  li.dup {
    opacity: 0.6;
  }

  .keep {
    padding-top: var(--space-2);
  }

  textarea {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    font: inherit;
    font-family: var(--font-serif);
    font-size: var(--text-ui);
    color: var(--ink);
    resize: vertical;
  }

  textarea.bad {
    border-color: var(--err);
  }

  .tag {
    grid-column: 2;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .error {
    font-size: var(--text-label);
    color: var(--err-ink);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .btn {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }

  .btn:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .btn.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  code {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--bg);
    font-size: 0.9em;
  }
</style>
