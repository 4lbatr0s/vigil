<script lang="ts">
  import { onDestroy } from "svelte";
  import { ApiError, createFromTemplate, getNote, getNoteCards, getRun, getRunResult, listAgents, putAgent, putNote, startCardProposals } from "$lib/api";
  import { extractCards, groundingHint, lintCard } from "@vigil/shared";
  import { appendCards, isCardLine, proposalsFrom, type Proposal } from "$lib/card-review";
  import { Badge, Button, Checkbox, Dialog, Stack, Textarea } from "$lib/ui";

  let { open = $bindable(false), noteId, onsaved }: { open: boolean; noteId: string; onsaved: () => void } = $props();

  type Step = "checking" | "needs-agent" | "running" | "review" | "empty" | "error";
  let step = $state<Step>("checking");
  let proposals = $state<Proposal[]>([]);
  let message = $state("");
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const kept = $derived(proposals.filter((p) => p.keep));
  const invalid = $derived(kept.some((p) => !isCardLine(p.line)));

  $effect(() => {
    if (!open) return;
    cancelled = false;
    step = "checking";
    message = "";
    proposals = [];
    void begin();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
  onDestroy(() => clearTimeout(timer));

  /** The note's text, to check each proposed answer against what the note actually says. */
  let noteBody = $state("");

  function hintsFor(line: string) {
    const card = extractCards(line)[0];
    if (!card) return [];
    const grounded = noteBody === "" ? null : groundingHint(card, noteBody);
    return [...lintCard(card), ...(grounded ? [grounded] : [])];
  }

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
    const [{ text }, existing, note] = await Promise.all([getRunResult(runId), getNoteCards(noteId), getNote(noteId)]);
    noteBody = note.body;
    proposals = proposalsFrom(text ?? "", existing);
    step = proposals.length === 0 ? "empty" : "review";
  }

  function close(): void {
    open = false;
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

<Dialog bind:open title="Make cards from this note" wide>
  {#if step === "checking" || step === "running"}
    <p class="muted" role="status">{step === "checking" ? "Getting ready…" : "Reading your note and writing cards. This can take a minute."}</p>
  {:else if step === "needs-agent"}
    <p>The Card maker is a helper that reads this note and suggests cards. It can only read: you decide which cards to keep, and nothing is added until you press Save.</p>
  {:else if step === "empty"}
    <p>No cards came back. The note may be too short, or the model could not follow the format. Try again, or write a card yourself as <code>Question :: Answer</code>.</p>
  {:else if step === "review"}
    <Stack gap={3}>
      <p class="muted">Check each card against your note. Edit the wording and untick what you do not want. Cards you keep are added under “Cards” in this note.</p>
      <ul class="list">
        {#each proposals as p (p.key)}
          <li>
            <Checkbox label="Keep" bind:checked={p.keep} disabled={p.duplicate} />
            <Textarea rows={2} bind:value={p.line} disabled={p.duplicate} invalid={p.keep && !isCardLine(p.line)} aria-label="Card text" />
            {#if p.duplicate}<Badge>already in this note</Badge>{/if}
            {#if !p.duplicate && p.keep}
              {#each hintsFor(p.line) as h (h.code)}<p class="muted">{h.message}</p>{/each}
            {/if}
          </li>
        {/each}
      </ul>
      {#if invalid}<p class="error" role="alert">One of the cards is not a single card any more. Use <code>Question :: Answer</code> or put <code>{"{{"}</code>braces<code>{"}}"}</code> around the hidden part.</p>{/if}
      {#if message}<p class="error" role="alert">{message}</p>{/if}
    </Stack>
  {:else}
    <p class="error" role="alert">{message}</p>
  {/if}
  {#snippet actions()}
    {#if step === "needs-agent"}
      <Button variant="ghost" onclick={close}>Not now</Button>
      <Button variant="primary" disabled={busy} onclick={() => void turnOn()}>Turn on the Card maker</Button>
    {:else if step === "review"}
      <Button variant="ghost" onclick={close}>Cancel</Button>
      <Button variant="primary" disabled={busy || kept.length === 0 || invalid} onclick={() => void save()}>Save {kept.length} {kept.length === 1 ? "card" : "cards"}</Button>
    {:else}
      <Button variant="ghost" onclick={close}>Close</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  p {
    margin: 0;
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list li {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  code {
    padding: 0 var(--s-1);
    border-radius: var(--r-control);
    background: var(--fill-selected);
    font: var(--weight-regular) var(--type-ui-size) / 1 var(--font-code);
  }
</style>
