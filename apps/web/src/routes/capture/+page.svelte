<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { ApiError, captureLine } from "$lib/api";
  import { shareLine } from "$lib/share";

  let text = $state("");
  let done = $state(false);
  let error = $state("");
  let busy = $state(false);

  // Something shared from another app arrives here as ?title=&text=&url=. It is shown first; nothing is saved until you press the button.
  onMount(() => {
    text = shareLine(page.url.searchParams);
  });

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || text.trim() === "") return;
    busy = true;
    error = "";
    try {
      await captureLine(text.trim());
      done = true;
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not add it";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Capture · Vigil</title></svelte:head>

<div class="page">
  <h1>Capture</h1>
  {#if done}
    <p>Added to your Inbox note.</p>
    <p><a class="btn" href="/">Back to your notes</a></p>
  {:else}
    <p class="muted">This goes to the end of your Inbox note. Edit it first if you like.</p>
    <form onsubmit={add}>
      <textarea rows="5" bind:value={text} aria-label="What to add to your Inbox" maxlength="2000" placeholder="A thought, a link, a question…"></textarea>
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy || text.trim() === ""}>Add to Inbox</button>
      </div>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</div>

<style>
  .page {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-6);
    display: grid;
    gap: var(--space-4);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  textarea {
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-ui);
    cursor: pointer;
    text-decoration: none;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  .error {
    color: var(--err-ink);
  }
</style>
