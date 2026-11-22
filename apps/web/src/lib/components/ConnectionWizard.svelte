<script lang="ts">
  import { untrack } from "svelte";
  import { ApiError, createConnection, probeConnection, updateConnection, type Connection, type ProbeResult } from "$lib/api";
  import { PRESETS, missingForTest, presetById, suggestName, type ProviderPreset } from "$lib/providers";
  import { Button, Cluster, Field, Input, Row, Select, Stack } from "$lib/ui";

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
    <Stack gap={3}>
      <h3>Which service?</h3>
      <div class="presets">
        {#each PRESETS as p (p.id)}
          <Row title={p.label} snippet={p.blurb} onclick={() => choose(p)} />
        {/each}
      </div>
      <div><Button variant="ghost" onclick={onCancel}>Cancel</Button></div>
    </Stack>
  {:else}
    <Stack gap={4}>
      <h3>{editing ? `Change ${editing.name}` : preset.label}</h3>
      <div class="form">
        <Stack gap={4}>
          <Field label="Name">
            {#snippet children({ id })}<Input {id} bind:value={name} maxlength={40} />{/snippet}
          </Field>
          <Field label="Address">
            {#snippet children({ id })}<Input {id} bind:value={baseUrl} placeholder="https://…" autocomplete="off" spellcheck={false} />{/snippet}
          </Field>
          {#if preset.id !== "ollama" && preset.id !== "lmstudio"}
            <Field label={editing?.hasKey ? "API key (saved; leave empty to keep it)" : "API key"} hint={preset.keyHint ? `${preset.keyHint} It is stored encrypted on this computer and never shown again.` : undefined}>
              {#snippet children({ id, describedby })}
                <Input {id} aria-describedby={describedby} type="password" bind:value={apiKey} autocomplete="off" spellcheck={false} placeholder={editing?.hasKey ? "••••••••" : "paste your key"} />
              {/snippet}
            </Field>
          {/if}
          <Cluster gap={3}>
            <Button disabled={testing || problem !== null} onclick={() => void test()}>{testing ? "Testing…" : "Test and list models"}</Button>
            {#if problem}<span class="hint">{problem}</span>{/if}
          </Cluster>
          {#if probe}
            {#if probe.ok}
              <p class="ok" role="status">Connected. {probe.models.length} {probe.models.length === 1 ? "model" : "models"} found.</p>
            {:else}
              <p class="bad" role="alert">{probe.error}</p>
            {/if}
          {/if}
          <Field label="Default model">
            {#snippet children({ id })}
              {#if probe?.ok && probe.models.length > 0}
                <Select {id} bind:value={model}>
                  {#each probe.models as m (m)}<option value={m}>{m}</option>{/each}
                  {#if model !== "" && !probe.models.includes(model)}<option value={model}>{model}</option>{/if}
                </Select>
              {:else}
                <Input {id} bind:value={model} placeholder="for example gpt-4o-mini, or test the connection to pick one" spellcheck={false} />
              {/if}
            {/snippet}
          </Field>
          {#if error}<p class="bad" role="alert">{error}</p>{/if}
          <Cluster gap={2}>
            <Button variant="primary" disabled={saving || name.trim() === "" || baseUrl.trim() === ""} onclick={() => void save()}>{saving ? "Saving…" : editing ? "Save changes" : "Save connection"}</Button>
            {#if !editing}<Button variant="ghost" onclick={() => (preset = null)}>Back</Button>{/if}
            <Button variant="ghost" onclick={onCancel}>Cancel</Button>
          </Cluster>
        </Stack>
      </div>
    </Stack>
  {/if}
</div>

<style>
  .wizard {
    padding: var(--s-4);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
  }

  h3 {
    margin: 0;
    font: var(--weight-strong) var(--type-body-size) / var(--type-body-lh) var(--font-ui);
  }

  .presets {
    margin: 0 calc(var(--s-3) * -1);
  }

  .form {
    max-width: 34rem;
  }

  .hint {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .ok,
  .bad {
    margin: 0;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .ok {
    color: var(--good);
  }

  .bad {
    color: var(--danger);
  }
</style>
