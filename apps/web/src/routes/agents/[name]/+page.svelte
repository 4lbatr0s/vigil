<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { AgentNameSchema, type Agent, type PermissionSettings, type Run, type ToolGrant } from "@vigil/shared";
  import { ApiError, createChat, getAgent, getAgentSkill, listAgents, listConnections, probeConnection, type Connection, getPermissions, getSchedule, listRuns, putAgent, runAgent, type Schedule } from "$lib/api";
  import { duplicateAgent } from "$lib/agent-design";
  import { TOOL_LABELS, addHost, agentToForm, describeGrants, exposure, formToAgent, noHostsWarning, riskyCombination, triggerProblem, type AgentForm } from "$lib/agent-form";
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
  let confirmOff = $state(false);
  let hostInput = $state("");
  let hostError = $state("");
  let connections = $state<Connection[]>([]);
  let models = $state<string[]>([]);
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const TOOLS: ToolGrant[] = ["read_notes", "write_notes", "web_fetch", "call_agents"];
  const problem = $derived(agent && form ? triggerProblem(form, agent) : null);

  /** The models of the connection this agent uses (its own, else the default), for the model list. */
  async function loadModels(): Promise<void> {
    models = [];
    const c = connections.find((x) => x.id === form?.connection) ?? connections.find((x) => x.isDefault);
    if (!c) return;
    try {
      const r = await probeConnection({ kind: c.kind, baseUrl: c.baseUrl, ...(c.readOnly ? {} : { connectionId: c.id }) });
      models = r.ok ? r.models : [];
    } catch {
      // The list is a convenience: without it the model box stays a plain text field.
      models = [];
    }
  }

  function toggleTool(tool: ToolGrant, on: boolean): void {
    if (!form) return;
    form.tools = on ? [...new Set([...form.tools, tool])] : form.tools.filter((t) => t !== tool);
    // Giving an agent the power to write starts with approvals on; you may switch that off below.
    if (tool === "write_notes" && on) form.strict = true;
  }

  const running = $derived(runs.some((r) => r.status === "running"));
  const grants = $derived(agent && settings ? describeGrants(agent, settings) : []);
  const reach = $derived(agent ? exposure({ tools: agent.tools, allowedHosts: agent.allowedHosts, strict: agent.strict }) : null);
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
      connections = await listConnections().catch(() => [] as Connection[]);
      void loadModels();
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

  /** Turning approvals off for an agent that reads notes and fetches the web asks first (ux-spec section 5). */
  function onStrictChange(event: Event): void {
    if (!form || !agent) return;
    const box = event.currentTarget as HTMLInputElement;
    if (box.checked) {
      form.strict = true;
      return;
    }
    if (agent.tools.includes("read_notes") && agent.tools.includes("web_fetch")) {
      box.checked = true; // stays on until the owner confirms
      confirmOff = true;
    } else {
      form.strict = false;
    }
  }

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

  function onAddHost(event: SubmitEvent): void {
    event.preventDefault();
    if (!form) return;
    const result = addHost(form.allowedHosts, hostInput);
    if (result.ok === false) {
      hostError = result.message;
      return;
    }
    form.allowedHosts = result.hosts;
    hostInput = "";
    hostError = "";
  }

  function removeHost(host: string): void {
    if (form) form.allowedHosts = form.allowedHosts.filter((h) => h !== host);
  }

  /** A switched-off copy with its own name, opened right away: a quick way to start a variation. */
  let skillCopied = $state(false);
  /** The agent as a SKILL.md, copied to the clipboard, for other tools or to share. */
  async function copySkill(): Promise<void> {
    try {
      const { text } = await getAgentSkill(agent?.name ?? "");
      await navigator.clipboard.writeText(text);
      skillCopied = true;
    } catch (err) {
      runError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not copy the skill";
    }
  }

  async function duplicate(): Promise<void> {
    if (!agent) return;
    try {
      const copy = await putAgent(duplicateAgent(agent, (await listAgents()).map((a) => a.name)));
      await goto(`/agents/${copy.name}`);
    } catch (err) {
      runError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not duplicate";
    }
  }

  /** The agent names a connection that was removed: its runs would fail, so say so before they do. */
  const missingConnection = $derived(form !== null && form.connection !== "" && connections.length > 0 && !connections.some((c) => c.id === form?.connection) ? form.connection : null);

  async function startChatWith(): Promise<void> {
    try {
      const t = await createChat(name);
      await goto(`/chat/${t.id}`);
    } catch (err) {
      runError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the chat";
    }
  }

  let newTest = $state("");
  /** Saved sample tasks: keep a few, re-run them after editing the instructions to see what changed. */
  async function saveTests(next: string[]): Promise<void> {
    if (!agent) return;
    try {
      agent = await putAgent({ ...agent, testTasks: next });
      newTest = "";
    } catch (err) {
      runError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save the test task";
    }
  }
  async function runTest(task: string): Promise<void> {
    try {
      const started = await runAgent(agent?.name ?? "", task);
      await goto(`/runs/${started.id}`);
    } catch (err) {
      runError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the run";
    }
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

    <section class="tests" aria-label="Saved test tasks">
      <h2 class="reach-title">Test tasks</h2>
      <p class="hint">Keep a few sample tasks and run them again after you change the instructions, to see what changed.</p>
      <ul>
        {#each agent.testTasks ?? [] as t, i (i)}
          <li>
            <span class="test-text">{t}</span>
            <button type="button" class="ghost" onclick={() => void runTest(t)}>Run</button>
            <button type="button" class="ghost" aria-label="Remove this test task" onclick={() => void saveTests((agent?.testTasks ?? []).filter((_, j) => j !== i))}>Remove</button>
          </li>
        {/each}
      </ul>
      {#if (agent.testTasks ?? []).length < 5}
        <form class="test-add" onsubmit={(e) => { e.preventDefault(); if (newTest.trim() !== "") void saveTests([...(agent?.testTasks ?? []), newTest.trim()]); }}>
          <input type="text" bind:value={newTest} placeholder="A sample task, for example: Summarise yesterday's notes" aria-label="New test task" maxlength="2000" />
          <button type="submit" class="ghost" disabled={newTest.trim() === ""}>Save</button>
        </form>
      {/if}
    </section>

    {#if reach}
      <section class="reach" aria-label="What this agent can reach">
        <h2 class="reach-title">What it can reach</h2>
        <ul>
          {#each reach.lines as l (l.label)}
            <li class:on={l.on}><span class="reach-label">{l.label}</span><span class="reach-text">{l.text}</span></li>
          {/each}
        </ul>
        {#if reach.all}<p class="reach-note">All three together are the risky mix: keep approvals on, and list only sites you trust.</p>{/if}
      </section>
    {/if}

    {#if risky}
      <p class="warn" role="note">
        This agent can read your notes and fetch web pages without asking you first. A web page could try to make it send your notes out. Turn on approvals, or limit the allowed sites.
      </p>
    {/if}

    <section class="edit" aria-label="Edit">
      <div class="toggles">
        <label><input type="checkbox" bind:checked={form.enabled} /> Enabled</label>
        <label><input type="checkbox" checked={form.strict} onchange={onStrictChange} /> Ask me before this agent writes</label>
      </div>
      <p class="hint">Writes wait in <a href="/approvals">Approvals</a> until you accept them.</p>
      {#if confirmOff}
        <div class="confirm" role="alertdialog" aria-labelledby="off-title">
          <h3 id="off-title">Turn off approvals for an agent that reads the web?</h3>
          <p>A web page could trick this agent into writing something or sending your note text to a host you allowed. With approvals on, you check every write first.</p>
          <div class="actions">
            <button type="button" class="primary" onclick={() => (confirmOff = false)}>Keep approvals on</button>
            <button type="button" class="danger" onclick={() => { form && (form.strict = false); confirmOff = false; }}>Turn off</button>
          </div>
        </div>
      {/if}

      {#if form.tools.includes("web_fetch")}
        <div class="field hosts">
          <span id="hosts-label">Allowed sites (web access)</span>
          <ul class="chips" aria-labelledby="hosts-label">
            {#each form.allowedHosts as host (host)}
              <li class="chip">{host} <button type="button" class="x" aria-label={`Remove ${host}`} onclick={() => removeHost(host)}>×</button></li>
            {/each}
          </ul>
          <form class="host-add" onsubmit={onAddHost}>
            <input type="text" class="mono" bind:value={hostInput} placeholder="example.com" aria-label="Add an allowed site" aria-describedby="host-err" autocomplete="off" spellcheck="false" />
            <button type="submit" class="ghost">Add</button>
          </form>
          {#if hostError}<span id="host-err" class="error" role="alert">{hostError}</span>{/if}
          {#if noHostsWarning(agent, form.allowedHosts)}<span class="warn-line" role="status">{noHostsWarning(agent, form.allowedHosts)}</span>{/if}
          <span class="hint">Only exact host names work (no subdomains, no wildcards), and never local or private addresses. Every address the agent fetches is written in its run log.</span>
        </div>
      {/if}
      <fieldset class="field">
        <legend>When it runs</legend>
        <div class="when">
          <select bind:value={form.trigger.kind} aria-label="When it runs">
            <option value="manual">Only when I start it</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="changes">When my notes change</option>
            {#if form.trigger.kind === "custom"}<option value="custom">Custom schedule</option>{/if}
          </select>
          {#if form.trigger.kind === "weekly"}
            <select bind:value={form.trigger.day} aria-label="Day of the week">
              {#each DAY_NAMES as d, i (d)}<option value={i}>{d}</option>{/each}
            </select>
          {/if}
          {#if form.trigger.kind === "daily" || form.trigger.kind === "weekly"}
            <input type="time" bind:value={form.trigger.time} aria-label="Time of day" />
          {/if}
          {#if form.trigger.kind === "changes"}
            <span class="hint">checking every</span>
            <input type="text" inputmode="numeric" class="narrow mono" bind:value={form.trigger.minutes} aria-label="Minutes between checks" />
            <span class="hint">minutes</span>
          {/if}
          {#if form.trigger.kind === "custom"}
            <input type="text" class="mono" bind:value={form.trigger.expression} aria-label="Schedule expression" />
          {/if}
        </div>
        {#if problem}<span class="error" role="alert">{problem}</span>{/if}
      </fieldset>
      <fieldset class="field">
        <legend>What it may do</legend>
        {#each TOOLS as t (t)}
          <label class="tool">
            <input type="checkbox" checked={form.tools.includes(t)} onchange={(e) => toggleTool(t, e.currentTarget.checked)} />
            <span><strong>{TOOL_LABELS[t].label}</strong> <span class="hint">{TOOL_LABELS[t].detail}</span></span>
          </label>
        {/each}
      </fieldset>
      <label class="field">
        <span>Description</span>
        <input type="text" bind:value={form.description} maxlength="280" />
      </label>
      <details class="advanced" open={missingConnection !== null}>
        <summary>Advanced: model, budget and instructions</summary>
      <label class="field">
        <span>Token budget per run</span>
        <input type="text" inputmode="numeric" bind:value={form.tokenBudget} class="narrow mono" />
      </label>
      {#if missingConnection}
        <p class="warn" role="alert">This agent uses the connection "{missingConnection}", which no longer exists, so its runs will fail. Pick another connection below.</p>
      {/if}
      {#if connections.length > 0}
        <label class="field">
          <span>Model connection</span>
          <select bind:value={form.connection} onchange={() => void loadModels()}>
            <option value="">Default connection</option>
            {#each connections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            {#if missingConnection}<option value={missingConnection}>{missingConnection} (removed)</option>{/if}
          </select>
        </label>
      {/if}
      <label class="field">
        <span>Model (empty uses the connection's default)</span>
        {#if models.length > 0}
          <select bind:value={form.model}>
            <option value="">Connection default</option>
            {#each models as m (m)}<option value={m}>{m}</option>{/each}
            {#if form.model !== "" && !models.includes(form.model)}<option value={form.model}>{form.model}</option>{/if}
          </select>
        {:else}
          <input type="text" bind:value={form.model} class="mono" />
        {/if}
      </label>

      <label class="field">
        <span>What it does when started without instructions</span>
        <input type="text" bind:value={form.defaultTask} />
      </label>
      <label class="field">
        <span>System prompt</span>
        <textarea rows="10" bind:value={form.systemPrompt}></textarea>
      </label>
      </details>

      {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
      <div class="actions">
        <button type="button" class="primary" disabled={busy || !dirty || problem !== null} onclick={() => void save()}>Save</button>
        <button type="button" class="ghost" disabled={running} onclick={() => void runNow()}>{running ? "Running…" : "Run now"}</button>
        <button type="button" class="ghost" onclick={() => void startChatWith()}>Chat</button>
        <button type="button" class="ghost" onclick={() => void duplicate()}>Duplicate</button>
        <button type="button" class="ghost" onclick={() => void copySkill()} title="Copy this agent as a SKILL.md file, the open format other AI tools read">{skillCopied ? "Copied" : "Copy as SKILL.md"}</button>
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
  .tests {
    margin: var(--space-4) 0;
  }
  .tests ul {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .tests li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .test-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .test-add {
    display: flex;
    gap: var(--space-2);
  }
  .test-add input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .reach {
    margin: var(--space-4) 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .reach-title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink-muted);
  }
  .reach ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .reach li {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: var(--space-3);
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .reach li.on {
    color: var(--ink);
  }
  .reach-label {
    font-weight: 600;
  }
  .reach-note {
    margin: var(--space-2) 0 0;
    font-size: var(--text-label);
    color: var(--ink);
  }
  @media (max-width: 639px) {
    .reach li {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
  .page {
    padding: var(--space-6);
    max-width: 860px;
    margin-inline: auto;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  fieldset.field {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  fieldset.field legend {
    padding: 0;
    margin-bottom: var(--space-1);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .tool {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
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
  .advanced > summary {
    cursor: pointer;
    padding: var(--space-2) 0;
    font-size: var(--text-ui);
    color: var(--ink-muted);
  }
  .advanced[open] > summary {
    margin-bottom: var(--space-3);
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
  .confirm {
    border: 1px solid var(--err);
    border-radius: var(--radius);
    padding: var(--space-3);
    margin: var(--space-3) 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-label);
  }
  .confirm h3 {
    font-size: var(--text-ui);
    font-weight: 600;
  }
  button.danger {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--err);
    border-radius: var(--radius);
    color: var(--err-ink);
    font-size: var(--text-label);
  }
  .host-add {
    display: flex;
    gap: var(--space-2);
  }
  .host-add input {
    max-width: 280px;
  }
  .x {
    margin-left: var(--space-1);
    color: var(--ink-muted);
  }
  .warn-line {
    color: var(--ink);
    border-left: 2px solid var(--amber);
    padding-left: var(--space-2);
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
