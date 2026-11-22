<script lang="ts">
  import { goto } from "$app/navigation";
  import type { Agent } from "@vigil/shared";
  import { ApiError, createChat, listAgents } from "$lib/api";
  import { askMessage, stashDraft } from "$lib/chat-draft";
  import { Button, Dialog, Field, Select, Stack, Textarea } from "$lib/ui";

  let {
    open = $bindable(false),
    noteId,
    title,
    selection,
  }: { open: boolean; noteId: string; title: string; selection: string | null } = $props();

  let agents = $state<Agent[]>([]);
  let agent = $state("");
  let instruction = $state("");
  let error = $state("");
  let busy = $state(false);
  let loaded = $state(false);

  $effect(() => {
    if (!open) return;
    error = "";
    loaded = false;
    void (async () => {
      try {
        // Any enabled agent that can read notes can be asked about one.
        agents = (await listAgents()).filter((a) => a.enabled && a.tools.includes("read_notes"));
        if (!agents.some((a) => a.name === agent)) agent = agents[0]?.name ?? "";
      } catch (err) {
        error = err instanceof Error ? err.message : "Could not load the agents";
      }
      loaded = true;
    })();
  });

  function close(): void {
    open = false;
    instruction = "";
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!agent || instruction.trim() === "" || busy) return;
    busy = true;
    error = "";
    try {
      const thread = await createChat(agent);
      stashDraft(thread.id, askMessage({ noteId, title, selection, instruction }));
      open = false;
      instruction = "";
      await goto(`/chat/${thread.id}`);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the chat";
    } finally {
      busy = false;
    }
  }

</script>

<Dialog bind:open title="Ask an agent">
  <form id="ask-form" onsubmit={submit}>
    <Stack gap={4}>
      {#if !loaded}
        <p class="muted">Loading agents…</p>
      {:else if agents.length === 0}
        <p class="muted">No enabled agent can read notes yet. <a href="/agents">Add or turn on an agent</a>.</p>
      {:else}
        <Field label="Agent">
          {#snippet children({ id })}
            <Select {id} bind:value={agent}>{#each agents as a (a.name)}<option value={a.name}>{a.name}</option>{/each}</Select>
          {/snippet}
        </Field>
        {#if selection && selection.trim() !== ""}
          <p class="quote" aria-label="Selected text">{selection.trim().slice(0, 200)}{selection.trim().length > 200 ? "…" : ""}</p>
        {:else}
          <p class="muted">About the whole note “{title}”.</p>
        {/if}
        <Field label="What should it do?" hint="Opens a chat with this filled in. Nothing is sent until you press Send there.">
          {#snippet children({ id, describedby })}
            <Textarea
              {id}
              aria-describedby={describedby}
              rows={3}
              bind:value={instruction}
              placeholder="Summarise this, tighten the wording, find related notes…"
              onkeydown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              }}
            />
          {/snippet}
        </Field>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </Stack>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={close}>Cancel</Button>
    <Button variant="primary" type="submit" form="ask-form" disabled={busy || !loaded || agents.length === 0 || instruction.trim() === ""}>Open chat</Button>
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

  .quote {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    background: var(--fill-hover);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-prose);
  }
</style>
