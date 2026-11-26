<script lang="ts">
import { noteHref, NOTES_PATH } from "$lib/links";
  import { Button, Checkbox, Cluster, Input, Page, Row, Stack, Textarea } from "$lib/ui";
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { ApiError, addMisconceptions, createFromTemplate, enrollRecall, getRecall, getRun, getRunResult, listAgents, listMisconceptions, listNotes, putAgent, resolveMisconception, recordRecall, startRecallCheck, type Misconception, type RecallItem, type RecallResult } from "$lib/api";
  import { checkItems } from "$lib/recall-feedback";
  import { relativeTime, untilText } from "$lib/note-list";

  type Step = "pick" | "write" | "running" | "feedback" | "done" | "error";

  let step = $state<Step>("pick");
  let items = $state<RecallItem[]>([]);
  let titles = $state(new Map<string, string>());
  let recall = $state("");
  let feedback = $state("");
  let message = $state("");
  let busy = $state(false);
  let next = $state<RecallItem | null>(null);
  /** Things you got wrong on this note before and have not sorted out yet. */
  let shaky = $state<Misconception[]>([]);
  /** The checker's "Check" points, each with whether you keep it. */
  let found = $state<{ text: string; keep: boolean }[]>([]);
  let own = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  const noteId = $derived(page.url.searchParams.get("note"));
  const title = $derived(noteId ? (titles.get(noteId) ?? noteId) : "");
  const due = $derived(items.filter((i) => i.isDue));

  onMount(async () => {
    try {
      const [r, notes] = await Promise.all([getRecall(), listNotes()]);
      items = r;
      titles = new Map(notes.map((n) => [n.id, n.title]));
      step = noteId ? "write" : "pick";
      if (noteId) shaky = await listMisconceptions(noteId);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not load");
    }
  });
  onDestroy(() => clearTimeout(timer));

  async function sorted(item: Misconception): Promise<void> {
    try {
      await resolveMisconception(item.id);
      shaky = shaky.filter((m) => m.id !== item.id);
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    }
  }

  function addOwn(event: SubmitEvent): void {
    event.preventDefault();
    const text = own.trim();
    if (text.length < 3) return;
    found = [...found, { text: text.slice(0, 300), keep: true }];
    own = "";
  }

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function check(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!noteId || busy) return;
    busy = true;
    message = "";
    try {
      // The checker has no tools; the note and your words travel in its task. Turned on here because you asked for the check.
      let agent = (await listAgents()).find((a) => a.name === "recall-checker");
      if (!agent) agent = await createFromTemplate("recall-checker");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      await enrollRecall(noteId);
      step = "running";
      const started = await startRecallCheck(noteId, recall.trim());
      await wait(started.id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the check");
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
      fail(run.error ?? `The checker stopped: ${run.status}`);
      return;
    }
    feedback = (await getRunResult(runId)).text ?? "";
    found = checkItems(feedback).map((text) => ({ text, keep: true }));
    step = "feedback";
  }

  async function record(result: RecallResult): Promise<void> {
    if (!noteId || busy) return;
    busy = true;
    try {
      const keep = found.filter((f) => f.keep).map((f) => f.text);
      if (keep.length > 0) await addMisconceptions(noteId, keep);
      next = await recordRecall(noteId, result);
      step = "done";
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Recall · Vigil</title></svelte:head>

<Page title="Recall" width="prose">
  <Stack gap={6}>
    {#if step === "pick"}
      <p class="muted">Put the note away and write what you remember. That effort, not rereading, is what builds memory.</p>
      {#if due.length > 0}
        <div class="list">
          {#each due as i (i.noteId)}
            <Row title={titles.get(i.noteId) ?? i.noteId} meta={`due ${relativeTime(i.due)}`} href={`/recall?note=${encodeURIComponent(i.noteId)}`} data-sveltekit-reload="" />
          {/each}
        </div>
      {:else if items.length > 0}
        <p>Nothing to recall right now. The next one is {untilText(items[0]!.due)}.</p>
      {:else}
        <p>Open a note and press Recall to start. Vigil brings it back after a day, then 3, 7 and 21 days.</p>
      {/if}
    {:else if step === "write"}
      <p>Without looking at <a href={noteHref(noteId ?? "")} target="_blank" rel="noopener">“{title}”</a>, write everything you can remember about it. Rough is fine.</p>
      {#if shaky.length > 0}
        <section class="panel" aria-labelledby="shaky-h">
          <h2 id="shaky-h">You mixed these up before</h2>
          <ul class="plain">
            {#each shaky as m (m.id)}
              <li><span>{m.text}</span> <Button variant="ghost" size="sm" onclick={() => void sorted(m)}>I have this now</Button></li>
            {/each}
          </ul>
        </section>
      {/if}
      <form onsubmit={check}>
        <Textarea rows={10} bind:value={recall} aria-label="What you remember" placeholder="Write what comes to mind…" maxlength={6000} />
        <Cluster gap={3}>
          <Button variant="primary" type="submit" disabled={busy || recall.trim().length === 0}>Check against my note</Button>
          <span class="muted">An agent compares it with the note only. It will not rewrite what you wrote.</span>
        </Cluster>
      </form>
    {:else if step === "running"}
      <p class="muted" aria-live="polite">Reading your note and your answer…</p>
    {:else if step === "feedback"}
      <section aria-labelledby="fb">
        <Stack gap={4}>
          <h2 id="fb">What the checker found</h2>
          <div class="feedback">{feedback}</div>
          <div class="panel">
            <Stack gap={3}>
              <h3>Anything you got wrong? Keep it to watch for next time.</h3>
              {#each found as f, i (i)}
                <Checkbox label={f.text} bind:checked={f.keep} />
              {/each}
              <form class="own" onsubmit={addOwn}>
                <Input bind:value={own} aria-label="Something you got wrong" placeholder="For example: mixed up DNA and RNA" maxlength={300} />
                <Button type="submit" disabled={own.trim().length < 3}>Add</Button>
              </form>
            </Stack>
          </div>
          <p class="muted">The checker can be wrong. Open <a href={noteHref(noteId ?? "")} target="_blank" rel="noopener">the note</a> to be sure.</p>
        </Stack>
      </section>
      <p>How did it go?</p>
      <Cluster gap={2}>
        <Button disabled={busy} onclick={() => void record("most")}>Got most of it</Button>
        <Button disabled={busy} onclick={() => void record("some")}>Got some</Button>
        <Button disabled={busy} onclick={() => void record("little")}>Hardly any</Button>
      </Cluster>
      {#if message}<p class="error" role="alert">{message}</p>{/if}
    {:else if step === "done"}
      <p>Saved. You will be asked again {next ? untilText(next.due) : "later"}.</p>
      <div><Button variant="primary" href={NOTES_PATH}>Back to your notes</Button></div>
    {:else}
      <p class="error" role="alert">{message}</p>
      <div><Button href="/recall" data-sveltekit-reload="">Start again</Button></div>
    {/if}
  </Stack>
</Page>

<style>
  p {
    margin: 0;
  }

  h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  h3 {
    margin: 0;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .feedback {
    white-space: pre-wrap;
    padding: var(--s-4);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
  }

  .panel {
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
  }

  .panel h2 {
    font: var(--weight-strong) var(--type-body-size) / var(--type-body-lh) var(--font-ui);
    margin-bottom: var(--s-2);
  }

  .plain {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .own {
    flex-direction: row;
  }
</style>
