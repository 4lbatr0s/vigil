<script lang="ts">
  import { tick } from "svelte";
  import { goto } from "$app/navigation";
  import type { Agent } from "@vigil/shared";
  import { ApiError, createChat, listAgents } from "$lib/api";
  import { askMessage, stashDraft } from "$lib/chat-draft";

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
  let box = $state<HTMLTextAreaElement | undefined>();
  let dialogEl = $state<HTMLDivElement | undefined>();
  let loaded = $state(false);
  let opener: Element | null = null;

  $effect(() => {
    if (!open) return;
    opener = document.activeElement;
    error = "";
    loaded = false;
    void (async () => {
      // Take focus out of the editor at once: anything typed while the agent list loads must not land in the note.
      await tick();
      dialogEl?.focus();
      try {
        // Any enabled agent that can read notes can be asked about one.
        agents = (await listAgents()).filter((a) => a.enabled && a.tools.includes("read_notes"));
        if (!agents.some((a) => a.name === agent)) agent = agents[0]?.name ?? "";
      } catch (err) {
        error = err instanceof Error ? err.message : "Could not load the agents";
      }
      loaded = true;
      await tick();
      box?.focus();
    })();
  });

  function close(): void {
    open = false;
    instruction = "";
    if (opener instanceof HTMLElement) opener.focus();
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

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }
</script>

{#if open}
  <button type="button" class="scrim" aria-label="Close" onclick={close}></button>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="ask-title" tabindex="-1" bind:this={dialogEl} onkeydown={onKeydown}>
    <h2 id="ask-title">Ask an agent</h2>
    <form onsubmit={submit}>
      {#if !loaded}
        <p class="muted">Loading agents…</p>
      {:else if agents.length === 0}
        <p class="muted">No enabled agent can read notes yet. <a href="/agents">Add or turn on an agent</a>.</p>
      {:else}
        <label class="field">
          <span>Agent</span>
          <select bind:value={agent}>
            {#each agents as a (a.name)}<option value={a.name}>{a.name}</option>{/each}
          </select>
        </label>
        {#if selection && selection.trim() !== ""}
          <p class="quote" aria-label="Selected text">{selection.trim().slice(0, 200)}{selection.trim().length > 200 ? "…" : ""}</p>
        {:else}
          <p class="muted">About the whole note “{title}”.</p>
        {/if}
        <label class="field">
          <span>What should it do?</span>
          <textarea
            bind:this={box}
            rows="3"
            bind:value={instruction}
            placeholder="Summarise this, tighten the wording, find related notes…"
            onkeydown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
          ></textarea>
        </label>
        <p class="muted">Opens a chat with this filled in. Nothing is sent until you press Send there, and changes to notes still need your approval when the agent is in strict mode.</p>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions">
        <button type="button" class="btn" onclick={close}>Cancel</button>
        <button type="submit" class="btn primary" disabled={busy || !loaded || agents.length === 0 || instruction.trim() === ""}>Open chat</button>
      </div>
    </form>
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
    top: 18vh;
    left: 50%;
    width: min(480px, calc(100vw - 2 * var(--space-4)));
    transform: translateX(-50%);
    padding: var(--space-6);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
  }

  h2 {
    margin-bottom: var(--space-4);
    font-family: var(--font-serif);
    font-size: var(--text-h3);
  }

  form {
    display: grid;
    gap: var(--space-3);
  }

  .field {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  select,
  textarea {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    font: inherit;
    font-size: var(--text-ui);
    color: var(--ink);
  }

  textarea {
    resize: vertical;
  }

  .quote {
    padding-left: var(--space-3);
    border-left: 2px solid var(--hairline);
    font-family: var(--font-serif);
    color: var(--ink-muted);
  }

  .muted {
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
</style>
