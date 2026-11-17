<script lang="ts">
  import { untrack } from "svelte";
  import { ApiError, createConnection, probeConnection, updateConnection, type Connection, type ProbeResult } from "$lib/api";
  import { PRESETS, missingForTest, presetById, suggestName, type ProviderPreset } from "$lib/providers";

  let {
    existing = [],
    editing = null,
    onDone,
    onCancel,
  }: {
    existing?: Connection[];
    /** A saved connection to change: the key box stays empty and keeps the saved key unless you type a new one. */
    editing?: Connection | null;
    onDone: (saved: Connection) => void;
    onCancel: () => void;
  } = $props();

  const startPreset = (): ProviderPreset | null => {
    if (!editing) return null;
    return PRESETS.find((p) => p.baseUrl === editing.baseUrl && p.kind === editing.kind) ?? presetById("custom") ?? null;
  };

  // The form starts from the connection being changed, once; this component is made again for each change.
  const start = untrack(() => editing);
  let preset = $state<ProviderPreset | null>(untrack(startPreset));
  let name = $state(start?.name ?? "");
  let baseUrl = $state(start?.baseUrl ?? "");
  let apiKey = $state("");
  let model = $state(start?.defaultModel ?? "");
  let probe = $state<ProbeResult | null>(null);
  let testing = $state(false);
  let saving = $state(false);
  let error = $state("");

  function choose(p: ProviderPreset): void {
    preset = p;
    name = suggestName(p, existing.map((c) => c.name));
    baseUrl = p.baseUrl;
    apiKey = "";
    model = "";
    probe = null;
    error = "";
  }

  const problem = $derived(missingForTest(preset ?? undefined, baseUrl, apiKey, editing?.hasKey === true));
  const kind = $derived(preset?.kind ?? editing?.kind ?? "openai");

  async function test(): Promise<void> {
    if (problem || testing) return;
    testing = true;
    error = "";
    try {
      probe = await probeConnection({ kind, baseUrl: baseUrl.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(editing && apiKey.trim() === "" ? { connectionId: editing.id } : {}) });
      if (probe.ok && model === "" && probe.models.length > 0) model = probe.models[0] ?? "";
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not test";
    } finally {
      testing = false;
    }
  }

  async function save(): Promise<void> {
    if (saving || name.trim() === "" || baseUrl.trim() === "") return;
    saving = true;
    error = "";
    const input = { name: name.trim(), kind, baseUrl: baseUrl.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(model.trim() ? { defaultModel: model.trim() } : {}) };
    try {
      onDone(editing ? await updateConnection(editing.id, input) : await createConnection(input));
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    } finally {
      saving = false;
    }
  }
</script>

<div class="wizard">
  {#if preset === null}
    <h3>Which service?</h3>
    <ul class="cards">
      {#each PRESETS as p (p.id)}
        <li>
          <button type="button" class="card" onclick={() => choose(p)}>
            <strong>{p.label}</strong>
            <span>{p.blurb}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p><button type="button" class="ghost" onclick={onCancel}>Cancel</button></p>
  {:else}
    <h3>{editing ? `Change ${editing.name}` : preset.label}</h3>
    <div class="form">
      <label><span>Name</span><input type="text" bind:value={name} maxlength="40" /></label>
      <label><span>Address</span><input type="text" bind:value={baseUrl} class="mono" placeholder="https://…" autocomplete="off" spellcheck="false" /></label>
      {#if preset.id !== "ollama" && preset.id !== "lmstudio"}
        <label>
          <span>API key {#if editing?.hasKey}<em>(saved; leave empty to keep it)</em>{/if}</span>
          <input type="password" bind:value={apiKey} class="mono" autocomplete="off" spellcheck="false" placeholder={editing?.hasKey ? "••••••••" : "paste your key"} />
          {#if preset.keyHint}<span class="hint">{preset.keyHint} It is stored encrypted on this computer and never shown again.</span>{/if}
        </label>
      {/if}
      <div class="row">
        <button type="button" class="primary" disabled={testing || problem !== null} onclick={() => void test()}>{testing ? "Testing…" : "Test and list models"}</button>
        {#if problem}<span class="hint">{problem}</span>{/if}
      </div>
      {#if probe}
        {#if probe.ok}
          <p class="ok" role="status">Connected. {probe.models.length} {probe.models.length === 1 ? "model" : "models"} found.</p>
        {:else}
          <p class="bad" role="alert">{probe.error}</p>
        {/if}
      {/if}
      <label>
        <span>Default model</span>
        {#if probe?.ok && probe.models.length > 0}
          <select bind:value={model}>
            {#each probe.models as m (m)}<option value={m}>{m}</option>{/each}
            {#if model !== "" && !probe.models.includes(model)}<option value={model}>{model}</option>{/if}
          </select>
        {:else}
          <input type="text" bind:value={model} class="mono" placeholder="for example gpt-4o-mini, or test the connection to pick one" spellcheck="false" />
        {/if}
      </label>
      {#if error}<p class="bad" role="alert">{error}</p>{/if}
      <div class="row">
        <button type="button" class="primary" disabled={saving || name.trim() === "" || baseUrl.trim() === ""} onclick={() => void save()}>{saving ? "Saving…" : editing ? "Save changes" : "Save connection"}</button>
        {#if !editing}<button type="button" class="ghost" onclick={() => (preset = null)}>Back</button>{/if}
        <button type="button" class="ghost" onclick={onCancel}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .wizard {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  h3 {
    font-size: var(--text-ui);
    font-weight: 600;
  }
  .cards {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-3);
  }
  .card {
    width: 100%;
    height: 100%;
    display: grid;
    gap: var(--space-1);
    text-align: left;
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .card:hover {
    background: var(--surface-hover);
  }
  .card span {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .form {
    display: grid;
    gap: var(--space-3);
    max-width: 34rem;
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  label > span:first-child {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  em {
    font-style: normal;
  }
  input,
  select {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .hint {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  button.primary,
  button.ghost {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--text-ui);
    cursor: pointer;
  }
  button.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  button.ghost {
    background: transparent;
    color: var(--ink);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ok {
    color: var(--ok);
  }
  .bad {
    color: var(--err-ink);
  }
</style>
