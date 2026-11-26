<script lang="ts">
import { noteHref } from "$lib/links";
  import { Button, Cluster, Field, Input, Page, Stack, Textarea } from "$lib/ui";
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { slugify } from "@vigil/shared";
  import { freeId } from "$lib/free-id";
  import { ApiError, listNotes, createFromTemplate, getRun, getRunResult, listAgents, putAgent, putNote, startOutline } from "$lib/api";

  type Step = "paste" | "running" | "review" | "error";

  let step = $state<Step>("paste");
  let source = $state("");
  let outline = $state("");
  let message = $state("");
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The first `# Title` line of the outline, or an empty string. */
  const outlineTitle = $derived(/^#\s+(.+)$/m.exec(outline)?.[1]?.trim() ?? "");
  const noteBody = $derived(outline.replace(/^#\s+.+\n?/m, "").trim() + "\n");
  let title = $state("");
  $effect(() => {
    if (step === "review" && title === "") title = outlineTitle;
  });

  onDestroy(() => clearTimeout(timer));

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  async function make(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      // The outliner has no tools; your text travels in its task. Turned on here because you asked for the outline.
      let agent = (await listAgents()).find((a) => a.name === "outliner");
      if (!agent) agent = await createFromTemplate("outliner");
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      step = "running";
      await wait((await startOutline(source.trim())).id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start");
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
      fail(run.error ?? `The outliner stopped: ${run.status}`);
      return;
    }
    outline = ((await getRunResult(runId)).text ?? "").trim();
    if (outline === "") fail("No outline came back. Try again with a bit more text.");
    else step = "review";
  }

  async function create(): Promise<void> {
    const name = title.trim();
    if (name === "" || busy) return;
    busy = true;
    try {
      const id = freeId(slugify(name), (await listNotes()).map((n) => n.id));
      const note = await putNote(id, { title: name, body: noteBody });
      await goto(noteHref(note.id));
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save the note";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Study outline · Vigil</title></svelte:head>

<Page title="Study outline" width="prose">
  <Stack gap={6}>
    {#if step === "paste"}
      <p class="muted">Paste a lecture transcript, an article or your rough notes. You get headings and a question for each, with the answers left empty: writing them in your own words is where the learning happens.</p>
      <form onsubmit={make}>
        <Textarea rows={12} bind:value={source} aria-label="Text to outline" placeholder="Paste text here…" maxlength={20000} />
        <Cluster gap={3}>
          <Button variant="primary" type="submit" disabled={busy || source.trim().length < 20}>Make an outline</Button>
          <span class="muted">A helper reads only this text. It will not answer the questions for you.</span>
        </Cluster>
      </form>
    {:else if step === "running"}
      <p class="muted" aria-live="polite">Reading your text…</p>
    {:else if step === "review"}
      <p class="muted">Edit anything you like. Your note is saved only when you press the button.</p>
      <Field label="Note title">
        {#snippet children({ id })}<Input {id} bind:value={title} />{/snippet}
      </Field>
      <Textarea rows={16} bind:value={outline} aria-label="Outline" />
      {#if message}<p class="error" role="alert">{message}</p>{/if}
      <Cluster gap={2}>
        <Button variant="primary" disabled={busy || title.trim() === ""} onclick={() => void create()}>Create the note</Button>
        <Button variant="ghost" onclick={() => ((step = "paste"), (title = ""))}>Start over</Button>
      </Cluster>
    {:else}
      <p class="error" role="alert">{message}</p>
      <div><Button onclick={() => ((step = "paste"), (message = ""))}>Back</Button></div>
    {/if}
  </Stack>
</Page>

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

  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

</style>
