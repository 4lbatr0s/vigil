<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { ApiError, getLlmStatus, getPermissions, getSession, getUsage, logout, putPermissions, type LlmStatus, type Session, type Usage } from "$lib/api";
  import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "$lib/appearance";
  import { fieldOfError, formToSettings, messageOfError, settingsToForm, type SettingsField, type SettingsForm } from "$lib/settings-form";

  let form = $state<SettingsForm | null>(null);
  let saved = $state<SettingsForm | null>(null);
  let llm = $state<LlmStatus | null>(null);
  let usage = $state<Usage | null>(null);
  let session = $state<Session | null>(null);
  let loadError = $state("");
  let saveError = $state<{ field: SettingsField | null; text: string } | null>(null);
  let notice = $state("");
  let busy = $state(false);
  let probing = $state(false);
  // Appearance lives in this browser only (it is not a server setting).
  let look = $state<Appearance>({ theme: "system", size: "medium" });
  function changeLook(next: Appearance): void {
    look = next;
    saveAppearance(next);
    applyAppearance(next);
  }

  const dirty = $derived(form !== null && saved !== null && JSON.stringify(form) !== JSON.stringify(saved));

  const tools = [
    { key: "read_notes", label: "Agents can read notes", why: "Off: agents see none of your notes, so most of them can do nothing." },
    { key: "write_notes", label: "Agents can write notes", why: "Off: agents can only read. Every write is saved first so you can undo it." },
    { key: "web_fetch", label: "Agents can fetch web pages", why: "Off: no agent reaches the internet, whatever its own settings say." },
    { key: "call_agents", label: "Agents can call other agents", why: "Off: an agent cannot start another one." },
  ] as const;

  onMount(() => {
    look = loadAppearance();
    void (async () => {
      try {
        const [settings, status, use] = await Promise.all([getPermissions(), getLlmStatus(), getUsage()]);
        form = settingsToForm(settings);
        saved = settingsToForm(settings);
        llm = status;
        usage = use;
        session = await getSession();
      } catch (err) {
        loadError = err instanceof Error ? err.message : "Could not load settings";
      }
    })();
  });

  async function save(): Promise<void> {
    if (!form) return;
    busy = true;
    saveError = null;
    notice = "";
    try {
      const out = await putPermissions(formToSettings(form));
      form = settingsToForm(out);
      saved = settingsToForm(out);
      notice = "Saved. Runs that start from now on use these settings.";
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
      saveError = { field: fieldOfError(detail), text: messageOfError(detail) };
    } finally {
      busy = false;
    }
  }

  async function signOut(): Promise<void> {
    try {
      await logout();
    } finally {
      await goto("/login");
    }
  }

  async function probe(): Promise<void> {
    probing = true;
    try {
      llm = await getLlmStatus(true);
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not test the connection";
    } finally {
      probing = false;
    }
  }

  const pct = $derived(usage && usage.cap ? Math.min(100, Math.round((usage.tokens / usage.cap) * 100)) : null);
</script>

<svelte:head><title>Settings · Vigil</title></svelte:head>

<main class="page">
  <h1>Settings</h1>
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}

  <section aria-labelledby="look">
    <h2 id="look">Appearance</h2>
    <p class="muted">Kept in this browser only.</p>
    <div class="look">
      <label class="look-field">
        <span>Theme</span>
        <select value={look.theme} onchange={(e) => changeLook({ ...look, theme: e.currentTarget.value === "light" || e.currentTarget.value === "dark" ? e.currentTarget.value : "system" })}>
          <option value="system">Same as the system</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label class="look-field">
        <span>Note text size</span>
        <select value={look.size} onchange={(e) => changeLook({ ...look, size: e.currentTarget.value === "small" || e.currentTarget.value === "large" ? e.currentTarget.value : "medium" })}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
    </div>
  </section>

  {#if form}
    <section aria-labelledby="perm">
      <h2 id="perm">Permissions</h2>
      <p class="muted">What agents may do. A switch that is off wins over any single agent's own settings.</p>
      <ul class="switches">
        {#each tools as t (t.key)}
          <li>
            <label class="switch">
              <input type="checkbox" bind:checked={form.tools[t.key]} />
              <span>{t.label}</span>
            </label>
            <span class="why">{t.why}</span>
          </li>
        {/each}
        <li>
          <label class="switch">
            <input type="checkbox" bind:checked={form.newAgentsStrict} />
            <span>New agents ask for my approval before writing</span>
          </label>
          <span class="why">Only sets the starting value for agents you add later. You can change any agent on its own page.</span>
        </li>
      </ul>

      <label class="field">
        <span>Highest token budget any run may use</span>
        <input type="text" inputmode="numeric" class="mono narrow" bind:value={form.maxTokenBudget} aria-describedby="err-budget" />
        {#if saveError?.field === "maxTokenBudget"}<span id="err-budget" class="error" role="alert">{saveError.text}</span>{/if}
      </label>
      <label class="field">
        <span>Keep run history for (days, 0 = forever)</span>
        <input type="text" inputmode="numeric" class="mono narrow" bind:value={form.retentionDays} aria-describedby="err-retention" />
        <span class="why">After this, run logs and undo copies are removed. Undo is no longer possible for older runs.</span>
        {#if saveError?.field === "retentionDays"}<span id="err-retention" class="error" role="alert">{saveError.text}</span>{/if}
      </label>

      {#if saveError && saveError.field === null}<p class="error" role="alert">{saveError.text}</p>{/if}
      <div class="actions">
        <button type="button" class="primary" disabled={busy || !dirty} onclick={() => void save()}>Save</button>
        {#if notice && !dirty}<span class="muted" aria-live="polite">{notice}</span>{/if}
      </div>
    </section>
  {/if}

  <section aria-labelledby="model">
    <h2 id="model">AI model</h2>
    {#if llm}
      <dl class="facts">
        <dt>Provider</dt><dd class="mono">{llm.provider}</dd>
        <dt>Address</dt><dd class="mono">{llm.baseUrl}</dd>
        <dt>Model</dt><dd class="mono">{llm.model ?? "not set"}</dd>
        <dt>API key</dt><dd>{llm.hasKey ? "present" : "not set"}</dd>
        <dt>Connection</dt>
        <dd>
          {llm.reachable === null ? "not tested" : llm.reachable ? "reachable" : "not reachable"}
          <button type="button" class="ghost" disabled={probing} onclick={() => void probe()}>{probing ? "Testing…" : "Test connection"}</button>
        </dd>
      </dl>
    {:else}
      <p class="muted">Loading…</p>
    {/if}
    <p class="muted">Keys are never typed here. Set these in the environment where the server runs, then restart it:</p>
    <pre class="env">VIGIL_LLM_PROVIDER=openai   # or ollama
VIGIL_LLM_BASE_URL=https://api.openai.com/v1
VIGIL_LLM_API_KEY=...        # never shown anywhere in the app
VIGIL_LLM_MODEL=...
VIGIL_MONTHLY_TOKEN_CAP=...  # optional warning level</pre>
  </section>

  <section aria-labelledby="use">
    <h2 id="use">Usage this month</h2>
    {#if usage}
      <p class="mono">{usage.tokens.toLocaleString("en")} tokens{usage.cap ? ` of ${usage.cap.toLocaleString("en")} (${pct}%)` : " (no cap set)"}</p>
      {#if usage.cap}
        <div class="bar" role="img" aria-label={`${pct}% of the monthly cap`}><span class="fill" style:width={`${pct}%`}></span></div>
        <p class="muted">The cap is a warning only. It never stops an agent.</p>
      {/if}
    {/if}
  </section>
  <section aria-labelledby="access">
    <h2 id="access">Access</h2>
    {#if session?.required}
      <p>Signed in. <button type="button" class="ghost" onclick={() => void signOut()}>Sign out</button></p>
    {:else if session}
      <p class="muted">Local access: no token is set, so there is no login.</p>
    {/if}
  </section>
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 760px;
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
    margin-bottom: var(--space-4);
  }
  .look {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }

  .look-field {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .look-field select {
    min-width: 200px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-ui);
    color: var(--ink);
  }

  h2 {
    font-size: var(--text-ui);
    font-weight: 600;
    margin: var(--space-8) 0 var(--space-2);
  }
  .muted,
  .why {
    color: var(--ink-muted);
  }
  .why {
    display: block;
    font-size: var(--text-label);
    margin: var(--space-1) 0 0 var(--space-6);
  }
  .error {
    color: var(--err-ink);
    font-size: var(--text-label);
  }
  .switches {
    list-style: none;
    padding: 0;
    margin: var(--space-4) 0;
    display: grid;
    gap: var(--space-3);
  }
  .switch {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .field {
    display: grid;
    gap: var(--space-1);
    margin: var(--space-4) 0;
    font-size: var(--text-label);
  }
  .field > span:first-child {
    color: var(--ink-muted);
  }
  input[type="text"] {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-ui);
  }
  .narrow {
    max-width: 180px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .actions {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .primary,
  .ghost {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    font-size: var(--text-label);
  }
  .primary {
    background: var(--ink);
    color: var(--bg);
  }
  .ghost {
    border-color: var(--hairline);
    background: var(--surface);
    margin-left: var(--space-3);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .facts {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: var(--space-2) var(--space-4);
    margin: var(--space-3) 0;
    font-size: var(--text-label);
  }
  dt {
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
  }
  .env {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
    overflow-x: auto;
  }
  .bar {
    height: 2px;
    max-width: 320px;
    background: var(--hairline);
    margin: var(--space-2) 0;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ink-muted);
  }
</style>
