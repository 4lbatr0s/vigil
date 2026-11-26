<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getMeaning, putMeaning, type MeaningStatus } from "$lib/api";
  import { Button, Cluster, Input } from "$lib/ui";

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
    <p class="muted">Find notes that mean the same thing even when they share no word, in Ask, in Related notes and for your helpers. It needs a small embedding model on your default connection, for example <code>nomic-embed-text</code> on Ollama (run <code>ollama pull nomic-embed-text</code>). Your notes go only to that connection. Off until you name a model.</p>
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        void save(model.trim() === "" ? null : model.trim());
      }}
    >
      <Input id="meaning-model" bind:value={model} placeholder="nomic-embed-text" aria-label="Embedding model name" />
      <Cluster gap={2}>
        <Button type="submit" variant={status.model === null ? "primary" : "quiet"} disabled={busy}>{status.model === null ? "Turn on" : "Save"}</Button>
        {#if status.model !== null}<Button variant="ghost" disabled={busy} onclick={() => { model = ""; void save(null); }}>Turn off</Button>{/if}
      </Cluster>
    </form>
    {#if status.model !== null}
      <p class="muted" aria-live="polite">{status.working ? "Reading your notes…" : "Ready."} {status.embedded} of {status.notes} notes read.</p>
    {/if}
    {#if status.error}<p class="error" role="alert">{status.error}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin: var(--s-3) 0;
  }

  .form :global(input) {
    flex: 1 1 14rem;
    width: auto;
  }

  code {
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-code);
  }

  .muted {
    margin: 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    margin: 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
