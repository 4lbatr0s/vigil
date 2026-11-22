<script lang="ts">
  import { onDestroy } from "svelte";
  import { ApiError, createFromTemplate, getRun, getRunResult, listAgents, putAgent, startAsk, type Passage } from "$lib/api";
  import { NOT_COVERED, splitAnswer, usedPassages, verdict } from "$lib/citations";
  import CitedAnswer from "$lib/components/CitedAnswer.svelte";
  import { Button, Input, Page, Stack } from "$lib/ui";

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
  const trust = $derived(verdict(answer, passages));

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
      let agent = (await listAgents()).find((a) => a.name === "note-asker");
      if (!agent) agent = await createFromTemplate("note-asker");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      asked = question.trim();
      step = "running";
      const started = await startAsk(asked);
      passages = started.passages;
      if (started.run === null) {
        answer = NOT_COVERED + ".";
        step = "done";
        return;
      }
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

<svelte:head><title>Ask your notes · Vigil</title></svelte:head>

<Page title="Ask your notes" width="prose">
  <Stack gap={6}>
    <p class="muted">Answers come only from lines of your own notes, and every claim points at the line behind it. If your notes do not cover a question, you are told so.</p>

    <form onsubmit={ask}>
      <Input bind:value={question} aria-label="Your question" placeholder="What does my note say about…" maxlength={500} />
      <Button variant="primary" type="submit" disabled={busy || question.trim().length < 3}>Ask</Button>
    </form>

    {#if step === "running"}
      <p class="muted" aria-live="polite">Reading your notes…</p>
    {:else if step === "error"}
      <p class="error" role="alert">{message}</p>
    {:else if step === "done"}
      <section aria-label="Answer" aria-live="polite">
        <Stack gap={4}>
          <h2>{asked}</h2>
          <CitedAnswer {parts} {used} sourcesTitle="Where it comes from" warning={trust === "no-marks" ? "This answer has no source marks, so nothing in it is backed by your notes. Do not trust it." : trust === "bad-marks" ? "A mark points at a line that was never given. Check the sources below before you trust this." : null} />
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
    gap: var(--s-2);
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
