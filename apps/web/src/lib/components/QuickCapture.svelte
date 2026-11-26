<script lang="ts">
  /**
   * Capture from anywhere (2026-11-26): the C key or "Capture a thought" in the palette opens this dialog; Enter adds
   * the line to the Inbox note and closes it. Sorting happens later, on Today.
   */
  import { ApiError, captureLine } from "$lib/api";
  import { Button, Dialog, Input } from "$lib/ui";

  let { open = $bindable(false) }: { open: boolean } = $props();
  let text = $state("");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) error = "";
  });

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const line = text.trim();
    if (line === "" || busy) return;
    busy = true;
    try {
      await captureLine(line);
      text = "";
      open = false;
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not add it";
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Capture" description="It goes to your inbox. Sort it later.">
  <form id="quick-capture" onsubmit={add}>
    <!-- svelte-ignore a11y_autofocus -->
    <Input bind:value={text} aria-label="What is on your mind?" placeholder="What is on your mind?" maxlength={2000} autofocus />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="quick-capture" disabled={busy || text.trim() === ""}>Add to inbox</Button>
  {/snippet}
</Dialog>

<style>
  form :global(input) {
    width: 100%;
    font-family: var(--font-prose);
    font-size: var(--type-body-size);
  }

  .error {
    margin: var(--s-2) 0 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
