<script lang="ts">
  import { tick } from "svelte";
  import { goto } from "$app/navigation";
  import { ApiError, createChat, createFromTemplate, getNote, listAgents, putAgent } from "$lib/api";
  import { STUDY_MODES, stashDraft, studyMessage, type StudyMode } from "$lib/chat-draft";

  let { open = $bindable(false), noteId, title }: { open: boolean; noteId: string; title: string } = $props();

  let mode = $state<StudyMode>("socratic-tutor");
  let busy = $state(false);
  let error = $state("");
  let dialogEl = $state<HTMLDivElement | undefined>();
  let opener: Element | null = null;

  $effect(() => {
    if (!open) return;
    opener = document.activeElement;
    error = "";
    void tick().then(() => dialogEl?.focus());
  });

  function close(): void {
    open = false;
    if (opener instanceof HTMLElement) opener.focus();
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

{#if open}
  <button type="button" class="scrim" aria-label="Close" onclick={close}></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="sw-title"
    tabindex="-1"
    bind:this={dialogEl}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }}
  >
    <h2 id="sw-title">Study “{title}”</h2>
    <p class="muted">Thinking it through yourself is what makes it stick. These helpers ask first and explain last.</p>
    <div class="modes" role="radiogroup" aria-label="How do you want to study?">
      {#each STUDY_MODES as m (m.id)}
        <label class="mode" class:on={mode === m.id}>
          <input type="radio" name="mode" value={m.id} bind:group={mode} />
          <span class="t">{m.title}</span>
          <span class="b">{m.blurb}</span>
        </label>
      {/each}
    </div>
    <p class="muted">Opens a chat with your note filled in; you press Send. The helper can only see this note and cannot change anything.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={close}>Cancel</button>
      <button type="button" class="btn primary" disabled={busy} onclick={() => void start()}>{busy ? "Getting ready…" : "Open chat"}</button>
    </div>
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
    top: 14vh;
    left: 50%;
    display: grid;
    gap: var(--space-3);
    width: min(520px, calc(100vw - 2 * var(--space-4)));
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

  .modes {
    display: grid;
    gap: var(--space-2);
  }

  .mode {
    display: grid;
    gap: 2px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .mode:hover {
    background: var(--surface-hover);
  }

  .mode.on {
    border-color: var(--ink);
    background: var(--surface-raised);
  }

  .mode input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .mode:has(input:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  .t {
    font-weight: 600;
  }

  .b {
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
