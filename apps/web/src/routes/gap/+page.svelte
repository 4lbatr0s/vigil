<script lang="ts">
  import { onDestroy } from "svelte";
  import { ApiError, createFromTemplate, getRun, getRunResult, listAgents, putAgent, startGap, type Passage } from "$lib/api";
  import { splitAnswer, usedPassages, verdict } from "$lib/citations";
  import CitedAnswer from "$lib/components/CitedAnswer.svelte";
  import { Button, Page, Stack, Textarea } from "$lib/ui";

  type Step = "ask" | "running" | "done" | "error";

  let step = $state<Step>("ask");
  let question = $state("");
  let asked = $state("");
  let answer = $state("");
  let passages = $state<Passage[]>([]);
  let message = $state("");
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const parts = $derived(splitAnswer(answer, passages));
  const used = $derived(usedPassages(answer, passages));
  const badMarks = $derived(verdict(answer, passages) === "bad-marks");
  
  onDestroy(() => clearTimeout(timer));

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function ask(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      let agent = (await listAgents()).find((a) => a.name === "gap-checker");
      if (!agent) agent = await createFromTemplate("gap-checker");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      asked = question.trim();
      step = "running";
      const started = await startGap(asked);
      passages = started.passages;
      await wait(started.run.id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not ask");
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
      fail(run.error ?? `The agent stopped: ${run.status}`);
      return;
    }
    answer = ((await getRunResult(runId)).text ?? "").trim();
    if (answer === "") fail("No answer came back. Try asking in other words.");
    else step = "done";
  }
</script>

<svelte:head><title>Gap check · Vigil</title></svelte:head>

<Page title="Gap check" width="prose">
  <Stack gap={6}>
    <p class="muted">Paste an article, a chapter or a lecture transcript. An agent compares it with your notes and lists what you already have, what is missing and what disagrees. It reads only that text and your notes.</p>

    <form onsubmit={ask}>
      <Textarea rows={8} bind:value={question} aria-label="Text to compare with your notes" placeholder="Paste text here…" maxlength={12000} />
      <div><Button variant="primary" type="submit" disabled={busy || question.trim().length < 40}>Compare with my notes</Button></div>
    </form>

    {#if step === "running"}
      <p class="muted" aria-live="polite">Reading your notes…</p>
    {:else if step === "error"}
      <p class="error" role="alert">{message}</p>
    {:else if step === "done"}
      <section aria-label="Answer" aria-live="polite">
        <Stack gap={4}>
          <h2>What the text says, against your notes</h2>
          <CitedAnswer {parts} {used} preserveLines sourcesTitle="Your note lines it used" warning={badMarks ? "A mark points at a note line that was never given. Check the lines below before you trust that point." : null} />
        </Stack>
      </section>
    {/if}
  </Stack>
</Page>

<style>
  h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

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
</style>
