<script lang="ts">
  import { ApiError, deleteNote } from "$lib/api";
  import { Button, Dialog } from "$lib/ui";

  let { noteId, title, open = $bindable(false), ondeleted }: { noteId: string; title: string; open?: boolean; ondeleted: (id: string) => void } = $props();

  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) error = "";
  });

  async function confirm(): Promise<void> {
    busy = true;
    error = "";
    try {
      await deleteNote(noteId);
      open = false;
      ondeleted(noteId);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not delete the note";
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Delete this note?" description={`“${title}” is removed for good. This cannot be undone.`}>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>Keep it</Button>
    <Button variant="danger" disabled={busy} onclick={() => void confirm()}>Delete note</Button>
  {/snippet}
</Dialog>

<style>
  .error {
    margin: 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }
</style>
