<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { AgentNameSchema, type Agent, type PermissionSettings, type Run } from "@vigil/shared";
  import { ApiError, getAgent, getPermissions, getSchedule, listRuns, putAgent, runAgent, type Schedule } from "$lib/api";
  import { agentToForm, describeGrants, formToAgent, riskyCombination, type AgentForm } from "$lib/agent-form";
  import { describeCheck, formatStamp } from "$lib/format";
  import { refreshOnLive } from "$lib/live";
  import { describeTrigger, describeTriggerSentence, statusDot } from "$lib/schedule";
  import StatusDot from "$lib/components/StatusDot.svelte";

  const name = $derived(page.params.name ?? "");

  let agent = $state<Agent | null>(null);
  let form = $state<AgentForm | null>(null);
  let schedule = $state<Schedule | null>(null);
  let settings = $state<PermissionSettings | null>(null);
  let runs = $state<Run[]>([]);
  let loadError = $state("");
  let saveError = $state("");
  let runError = $state("");
  let notice = $state("");
  let busy = $state(false);

  const running = $derived(runs.some((r) => r.status === "running"));
  const grants = $derived(agent && settings ? describeGrants(agent, settings) : []);
  const risky = $derived(agent && form ? riskyCombination({ tools: agent.tools, strict: form.strict }) : false);
  const dirty = $derived(agent !== null && form !== null && JSON.stringify(agentToForm(agent)) !== JSON.stringify(form));

  async function load(): Promise<void> {
    if (!AgentNameSchema.safeParse(name).success) {
      loadError = "That is not a valid agent name.";
      return;
    }
    try {
      [agent, settings] = await Promise.all([getAgent(name), getPermissions()]);
      form = agentToForm(agent);
      schedule = await getSchedule(name);
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not load the agent";
    }
  }

  async function refreshRuns(): Promise<void> {
    try {
      runs = await listRuns({ agent: name, limit: 20 });
    } catch {
      // The next poll tries again; the page keeps showing the last list.
    }
  }

  onMount(() => {
    void load();
    // An invalid name never reaches the API, not even through the run list.
    return AgentNameSchema.safeParse(name).success ? refreshOnLive(refreshRuns, ["run"], 3000) : undefined;
  });

  async function save(overrides: Partial<AgentForm> = {}): Promise<boolean> {
    if (!agent || !form) return false;
    saveError = "";
    busy = true;
    try {
      const next = formToAgent(agent, { ...form, ...overrides });
      agent = await putAgent(next);
      form = agentToForm(agent);
      schedule = await getSchedule(name);
      notice = "Saved.";
      return true;
    } catch (err) {
      saveError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
      return false;
    } finally {
      busy = false;
    }
  }

  async function turnOn(): Promise<void> {
    if (await save({ enabled: true })) notice = "Turned on.";
  }

  async function runNow(): Promise<void> {
    runError = "";
    try {
      await runAgent(name);
      await refreshRuns();
    } catch (err) {
      runError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the run";
    }
  }
</script>

<svelte:head><title>{name} · Vigil</title></svelte:head>

<main class="page">
  <p class="crumb"><a href="/agents">Agents</a></p>

  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !agent || !form}
    <p class="muted">Loading…</p>
  {:else}
    <header class="head">
      <h1>{agent.name}</h1>
      <StatusDot state={statusDot(agent, runs[0])} />
    </header>
    {#if agent.description}<p class="muted">{agent.description}</p>{/if}

    {#if !agent.enabled}
      <section class="turn-on" aria-labelledby="turn-on-title">
        <h2 id="turn-on-title">This agent is off. It will not run on its own until you turn it on.</h2>
        <p>{describeTriggerSentence(agent.trigger)}</p>
        <ul class="grants">
          {#each grants as g (g.tool)}
            <li>
              <label>
                <input type="checkbox" checked={!g.blocked} disabled />
                <span>{g.text}</span>
              </label>
              {#if g.blocked}<span class="blocked">Turned off in <a href="/settings">Settings</a></span>{/if}
            </li>
          {/each}
          <li>Needs your approval before writing: <strong>{form.strict ? "on" : "off"}</strong>.</li>
        </ul>
        <div class="actions">
          <button type="button" class="primary" disabled={busy} onclick={() => void turnOn()}>Turn on</button>
          <button type="button" class="ghost" disabled={running} onclick={() => void runNow()}>Run once now</button>
        </div>
      </section>
    {/if}

    <section class="facts" aria-label="Schedule">
      <dl>
        <dt>Trigger</dt>
        <dd class="mono">{describeTrigger(agent.trigger)}</dd>
        <dt>Next run</dt>
        <dd class="mono">{schedule?.nextRunAt ? formatStamp(schedule.nextRunAt) : agent.enabled ? "none" : "off"}</dd>
        {#if agent.trigger.kind === "heartbeat"}
          <dt>Heartbeat</dt>
          <dd class="mono">{agent.enabled ? describeCheck(schedule?.lastCheckedAt ?? null, schedule?.lastSkipReason ?? null) : "off"}</dd>
        {/if}
        <dt>Last started</dt>
        <dd class="mono">{formatStamp(schedule?.lastStartedAt)}</dd>
        {#if schedule?.lastSkipReason && agent.trigger.kind !== "heartbeat"}
          <dt>Last skipped</dt>
          <dd class="mono">{schedule.lastSkipReason}</dd>
        {/if}
        <dt>Tools</dt>
        <dd class="chips">
          {#each agent.tools as t (t)}<span class="chip">{t}</span>{:else}<span class="muted">none</span>{/each}
        </dd>
      </dl>
    </section>

    {#if risky}
      <p class="warn" role="note">
        This agent can read your notes and fetch web pages without asking you first. A web page could try to make it send your notes out. Turn on approvals, or limit the allowed sites.
      </p>
    {/if}

    <section class="edit" aria-label="Edit">
      <div class="toggles">
        <label><input type="checkbox" bind:checked={form.enabled} /> Enabled</label>
        <label><input type="checkbox" bind:checked={form.strict} /> Ask me before this agent writes</label>
      </div>
      <p class="hint">With approvals on, writes wait in a queue until you accept them. This arrives in a later release; the setting is saved now.</p>

      <label class="field">
        <span>Description</span>
        <input type="text" bind:value={form.description} maxlength="280" />
      </label>
      <label class="field">
        <span>Token budget per run</span>
        <input type="text" inputmode="numeric" bind:value={form.tokenBudget} class="narrow mono" />
      </label>
      <label class="field">
        <span>Model (empty uses the default)</span>
        <input type="text" bind:value={form.model} class="mono" />
      </label>
      <label class="field">
        <span>System prompt</span>
        <textarea rows="10" bind:value={form.systemPrompt}></textarea>
      </label>

      {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
      <div class="actions">
        <button type="button" class="primary" disabled={busy || !dirty} onclick={() => void save()}>Save</button>
        <button type="button" class="ghost" disabled={running} onclick={() => void runNow()}>{running ? "Running…" : "Run now"}</button>
        {#if notice && !dirty}<span class="muted" aria-live="polite">{notice}</span>{/if}
      </div>
      {#if runError}<p class="error" role="alert">{runError}</p>{/if}
    </section>

    <section aria-labelledby="runs-title">
      <h2 id="runs-title" class="section">Recent runs</h2>
      <ul class="ledger">
        {#each runs as run (run.id)}
          <li>
            <a class="row" href={`/runs/${run.id}`}>
              <StatusDot state={statusDot({ enabled: true }, run)} label={run.status} />
              <span class="mono">{formatStamp(run.startedAt)}</span>
              <span class="mono">{run.status}</span>
              <span class="mono">{run.trigger}</span>
              <span class="mono">{run.tokensUsed} / {run.tokenBudget}</span>
            </a>
          </li>
        {:else}
          <li class="muted none">No runs yet.</li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 860px;
  }
  .crumb {
    font-size: var(--text-label);
    margin-bottom: var(--space-3);
  }
  .crumb a {
    color: var(--ink-muted);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
  }
  h2.section {
    font-size: var(--text-ui);
    font-weight: 600;
    margin: var(--space-8) 0 var(--space-2);
  }
  .muted,
  .hint {
    color: var(--ink-muted);
  }
  .hint {
    font-size: var(--text-label);
    margin: var(--space-1) 0 var(--space-4);
  }
  .error {
    color: var(--err-ink);
    margin: var(--space-2) 0;
  }
  .warn {
    border: 1px solid var(--amber);
    border-radius: var(--radius);
    padding: var(--space-3);
    margin: var(--space-4) 0;
    font-size: var(--text-label);
  }
  .turn-on {
    border: 1px solid var(--ink-muted);
    border-radius: var(--radius);
    padding: var(--space-4);
    margin: var(--space-4) 0;
    display: grid;
    gap: var(--space-3);
  }
  .turn-on h2 {
    font-size: var(--text-ui);
    font-weight: 600;
  }
  .grants {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-label);
  }
  .blocked {
    margin-left: var(--space-6);
    color: var(--ink-muted);
  }
  .blocked a {
    color: var(--ink);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }
  button.primary,
  button.ghost {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    font-size: var(--text-label);
  }
  button.primary {
    background: var(--ink);
    color: var(--bg);
  }
  button.ghost {
    border-color: var(--hairline);
    background: var(--surface);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: var(--space-2) var(--space-4);
    margin: var(--space-4) 0;
    font-size: var(--text-label);
  }
  dt {
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .chips {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .chip {
    font-family: var(--font-mono);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 0 var(--space-2);
  }
  .toggles {
    display: grid;
    gap: var(--space-2);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
    font-size: var(--text-label);
  }
  .field span {
    color: var(--ink-muted);
  }
  input[type="text"],
  textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-ui);
  }
  textarea {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    line-height: 1.5;
    resize: vertical;
  }
  .narrow {
    max-width: 160px;
  }
  .ledger {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--hairline);
  }
  .ledger > li {
    border-bottom: 1px solid var(--hairline);
  }
  .row {
    display: grid;
    grid-template-columns: 12px 140px 140px 100px 1fr;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2);
    color: var(--ink-muted);
    text-decoration: none;
  }
  .row:hover {
    background: var(--surface);
  }
  .none {
    padding: var(--space-3) var(--space-2);
  }
</style>
