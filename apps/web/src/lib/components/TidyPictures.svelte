<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getUnusedImages, tidyImages } from "$lib/api";

  let unused = $state<{ count: number; bytes: number } | null>(null);
  let asking = $state(false);
  let notice = $state("");
  let error = $state("");
  let busy = $state(false);

  const size = (bytes: number): string => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  onMount(async () => {
    try {
      unused = await getUnusedImages();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not check your pictures";
    }
  });

  async function tidy(): Promise<void> {
    busy = true;
    error = "";
    try {
      const r = await tidyImages();
      notice = `Removed ${r.removed} ${r.removed === 1 ? "picture" : "pictures"} (${size(r.bytes)}).`;
      unused = { count: 0, bytes: 0 };
      asking = false;
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not tidy";
    } finally {
      busy = false;
    }
  }
</script>

{#if unused}
  <section aria-labelledby="pictures">
    <h2 id="pictures">Pictures</h2>
    {#if unused.count === 0}
      <p class="muted">{notice || "Every picture in your vault is used by a note."}</p>
    {:else}
      <p class="muted">{unused.count} {unused.count === 1 ? "picture is" : "pictures are"} not linked from any note ({size(unused.bytes)}). Only pictures over an hour old count.</p>
      {#if !asking}
        <button type="button" class="btn" onclick={() => (asking = true)}>Remove unused pictures</button>
      {:else}
        <div role="alertdialog" aria-label="Confirm removing pictures" class="confirm">
          This deletes {unused.count} {unused.count === 1 ? "file" : "files"} from your vault for good. An older version of a note that used one (for example after undoing an agent) would show a missing picture.
          <button type="button" class="btn danger" disabled={busy} onclick={() => void tidy()}>Delete them</button>
          <button type="button" class="btn" onclick={() => (asking = false)}>Keep them</button>
        </div>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .confirm {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .btn {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .btn.danger {
    border-color: var(--err);
    color: var(--err-ink);
  }
  .error {
    color: var(--err-ink);
  }
</style>
