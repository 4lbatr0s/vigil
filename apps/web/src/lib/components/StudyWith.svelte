<script lang="ts">
  import { goto } from "$app/navigation";
  import { ApiError, createChat, createFromTemplate, getNote, listAgents, putAgent } from "$lib/api";
  import { STUDY_MODES, stashDraft, studyMessage, type StudyMode } from "$lib/chat-draft";
  import { Button, Dialog, Row, Stack } from "$lib/ui";

  let { open = $bindable(false), noteId, title }: { open: boolean; noteId: string; title: string } = $props();

  let mode = $state<StudyMode>("socratic-tutor");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (!open) return;
    error = "";
  });

  function close(): void {
    open = false;
  }

  async function start(): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      // Starting is the owner's act: it adds the chosen agent if needed and switches it on (it has no tools).
      let agent = (await listAgents()).find((a) => a.name === mode);
      if (!agent) agent = await createFromTemplate(mode);
      if (!agent.enabled) await putAgent({ ...agent, enabled: true });
      const note = await getNote(noteId);
      const thread = await createChat(mode);
      stashDraft(thread.id, studyMessage({ noteId, title: note.title, body: note.body, mode }));
      open = false;
      await goto(`/chat/${thread.id}`);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start";
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={`Study “${title}”`} description="Thinking it through yourself is what makes it stick. These helpers ask first and explain last.">
  <Stack gap={3}>
    <div class="modes" role="group" aria-label="How do you want to study?">
      {#each STUDY_MODES as m (m.id)}
        <Row title={m.title} snippet={m.blurb} wrap selected={mode === m.id} onclick={() => (mode = m.id)} />
      {/each}
    </div>
    <p class="muted">Opens a chat with your note filled in; you press Send. The helper sees only this note and cannot change anything.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </Stack>
  {#snippet actions()}
    <Button variant="ghost" onclick={close}>Cancel</Button>
    <Button variant="primary" disabled={busy} onclick={() => void start()}>{busy ? "Getting ready…" : "Open chat"}</Button>
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

  .modes {
    margin: 0 calc(var(--s-3) * -1);
  }
</style>
