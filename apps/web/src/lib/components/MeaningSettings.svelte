<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getMeaning, putMeaning, type MeaningStatus } from "$lib/api";

  let status = $state<MeaningStatus | null>(null);
  let model = $state("");
  let error = $state("");
  let busy = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function load(): Promise<void> {
    try {
      status = await getMeaning();
      if (document.activeElement?.id !== "meaning-model") model = status.model ?? "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load meaning search";
    }
  }

  onMount(() => {
    void load();
    // While notes are being read the numbers move; check every 2 s then, and not otherwise.
    timer = setInterval(() => {
      if (status?.working) void load();
    }, 2000);
    return () => clearInterval(timer);
  });

  async function save(next: string | null): Promise<void> {
    error = "";
    busy = true;
    try {
      status = await putMeaning(next);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    } finally {
      busy = false;
    }
  }
</script>

{#if status}
  <section aria-labelledby="meaning-settings">
    <h2 id="meaning-settings">Search by meaning</h2>
    <p class="muted">Find notes that mean the same thing even when they share no word, in Ask, in "Related notes" and for your agents. It needs a small embedding model on your default connection, for example <code>nomic-embed-text</code> on Ollama (run <code>ollama pull nomic-embed-text</code>). Your notes are sent only to that connection. Off until you name a model.</p>
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        void save(model.trim() === "" ? null : model.trim());
      }}
    >
      <input id="meaning-model" type="text" bind:value={model} placeholder="Model name, for example nomic-embed-text" aria-label="Embedding model name" />
      <button type="submit" class="save" disabled={busy}>{status.model === null ? "Turn on" : "Save"}</button>
      {#if status.model !== null}<button type="button" class="save" disabled={busy} onclick={() => { model = ""; void save(null); }}>Turn off</button>{/if}
    </form>
    {#if status.model !== null}
      <p class="muted" aria-live="polite">{status.working ? "Reading your notes…" : "Ready."} {status.embedded} of {status.notes} notes read.</p>
    {/if}
    {#if status.error}<p class="error" role="alert">{status.error}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }
  input {
    flex: 1 1 14rem;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .save {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .error {
    color: var(--err-ink);
  }
</style>
