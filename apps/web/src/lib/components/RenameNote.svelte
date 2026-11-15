<script lang="ts">
  import { tick } from "svelte";
  import { slugify, type Note } from "@vigil/shared";
  import { ApiError, planRenameNote, renameNote, type RenamePlan } from "$lib/api";

  let { noteId, title, onrenamed }: { noteId: string; title: string; onrenamed: (note: Note) => void } = $props();

  let open = $state(false);
  let draft = $state("");
  let plan = $state<RenamePlan | null>(null);
  let error = $state("");
  let busy = $state(false);
  let field = $state<HTMLInputElement | null>(null);

  const newId = $derived(slugify(draft.trim()));

  function start(): void {
    draft = title;
    plan = null;
    error = "";
    open = true;
    void tick().then(() => {
      field?.focus();
      field?.select();
    });
  }

  async function check(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = "";
    busy = true;
    try {
      plan = await planRenameNote(noteId, draft);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not check the rename";
    } finally {
      busy = false;
    }
  }

  async function confirm(): Promise<void> {
    busy = true;
    error = "";
    try {
      const note = await renameNote(noteId, draft);
      open = false;
      onrenamed(note);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not rename";
    } finally {
      busy = false;
    }
  }
</script>

{#if !open}
  <button type="button" class="act" onclick={start}>Rename</button>
{:else}
  <form class="panel" onsubmit={(e) => void check(e)} aria-label="Rename note">
    <label>
      <span class="label">New title</span>
      <input type="text" bind:this={field} bind:value={draft} oninput={() => (plan = null)} />
    </label>
    <p class="hint">The file name follows the title: <span class="mono">{newId || "…"}.md</span></p>
    {#if plan}
      <p class="hint" role="status">
        {#if plan.notesToChange.length === 0}
          No other note links here.
        {:else}
          This will update links in {plan.notesToChange.length} {plan.notesToChange.length === 1 ? "note" : "notes"}: {plan.titles.join(", ")}.
        {/if}
      </p>
      <div class="row">
        <button type="button" class="act primary" disabled={busy} onclick={() => void confirm()}>Rename</button>
        <button type="button" class="act" onclick={() => (open = false)}>Cancel</button>
      </div>
    {:else}
      <div class="row">
        <button type="submit" class="act primary" disabled={busy || draft.trim() === ""}>Check</button>
        <button type="button" class="act" onclick={() => (open = false)}>Cancel</button>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
{/if}

<style>
  .act {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
  }
  .act.primary {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }
  .act:disabled {
    opacity: 0.5;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + var(--space-2));
    z-index: 10;
    display: grid;
    gap: var(--space-2);
    width: min(380px, calc(100vw - 32px));
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
  }
  .label {
    display: block;
    color: var(--ink-muted);
    margin-bottom: var(--space-1);
  }
  input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: var(--text-ui);
  }
  .hint {
    color: var(--ink-muted);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .error {
    color: var(--err-ink);
  }
</style>
