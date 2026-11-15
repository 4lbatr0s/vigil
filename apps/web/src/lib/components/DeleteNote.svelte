<script lang="ts">
  import { ApiError, deleteNote } from "$lib/api";

  let { noteId, title, ondeleted }: { noteId: string; title: string; ondeleted: (id: string) => void } = $props();

  let asking = $state(false);
  let busy = $state(false);
  let error = $state("");

  async function confirm(): Promise<void> {
    busy = true;
    error = "";
    try {
      await deleteNote(noteId);
      asking = false;
      ondeleted(noteId);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not delete";
    } finally {
      busy = false;
    }
  }
</script>

{#if !asking}
  <button type="button" class="act" onclick={() => ((asking = true), (error = ""))}>Delete</button>
{:else}
  <span class="ask" role="alertdialog" aria-label="Confirm delete">
    <span>Delete “{title}” for good? This cannot be undone.</span>
    <button type="button" class="act danger" disabled={busy} onclick={() => void confirm()}>Delete</button>
    <button type="button" class="act" onclick={() => (asking = false)}>Keep</button>
  </span>
{/if}
{#if error}<span class="error" role="alert">{error}</span>{/if}

<style>
  .ask {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-label);
  }
  .act {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
  }
  .act.danger {
    border-color: var(--err);
    color: var(--err-ink);
  }
  .act:disabled {
    opacity: 0.5;
  }
  .error {
    color: var(--err-ink);
    font-size: var(--text-label);
  }
</style>
