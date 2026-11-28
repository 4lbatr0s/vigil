<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { AgentNameSchema, type Agent, type PermissionSettings, type Run, type ToolGrant } from "@vigil/shared";
  import { ApiError, clearAgentState, createChat, getAgentState, getAgentStateHistory, restoreAgentState, type AgentStateVersion, getModelCaps, getAgent, getAgentSkill, listAgents, listConnections, probeConnection, type Connection, getPermissions, getSchedule, listRuns, putAgent, runAgent, type Schedule } from "$lib/api";
  import { duplicateAgent } from "$lib/agent-design";
  import { TOOL_LABELS, addHost, agentToForm, describeGrants, exposure, formToAgent, noHostsWarning, riskyCombination, triggerProblem, type AgentForm } from "$lib/agent-form";
  import { describeCheck, formatStamp } from "$lib/format";
  import { capabilityWarnings, type ModelCaps } from "$lib/model-caps";
  import { refreshOnLive } from "$lib/live";
  import { describeTrigger, describeTriggerSentence, statusDot } from "$lib/schedule";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import { Badge, Button, Checkbox, Cluster, Dialog, Field, IconButton, Input, Menu, Page, Row, Select, Stack, Switch, Textarea } from "$lib/ui";

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
  let stateNote = $state<{ text: string; updatedAt: string } | null>(null);
  /** Earlier versions of the note, newest first (todo item 50). */
  let stateHistory = $state<AgentStateVersion[]>([]);
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const TOOLS: ToolGrant[] = ["read_notes", "write_notes", "web_fetch", "call_agents"];
  const problem = $derived(agent && form ? triggerProblem(form, agent) : null);

  /** What the agent's model can do, when its provider says (Ollama does). Warns before a run fails for it. */
  let caps = $state<ModelCaps | null>(null);
  const modelWarnings = $derived(agent && form ? capabilityWarnings({ tools: form.tools.length > 0, pictures: false }, caps) : []);
  $effect(() => {
    const connection = form?.connection ?? "";
    const model = form?.model ?? "";
    let stale = false;
    getModelCaps({ ...(connection ? { connection } : {}), ...(model ? { model } : {}) })
      .then((c) => {
        if (!stale) caps = c;
      })
      .catch(() => {
        if (!stale) caps = null;
      });
    return () => {
      stale = true;
    };
  });

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
      loadError = "That is not a valid helper name.";
      return;
    }
    try {
      [agent, settings] = await Promise.all([getAgent(name), getPermissions()]);
      form = agentToForm(agent);
      schedule = await getSchedule(name);
      stateNote = await getAgentState(name).catch(() => null);
      stateHistory = await getAgentStateHistory(name).catch(() => []);
      connections = await listConnections().catch(() => [] as Connection[]);
      void loadModels();
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not load the helper";
    }
  }

  function toggleApprove(tool: "fetch_url" | "call_agent", on: boolean): void {
    if (!form) return;
    form.approveTools = on ? [...new Set([...form.approveTools, tool])] : form.approveTools.filter((t) => t !== tool);
  }

  async function clearNote(): Promise<void> {
    try {
      await clearAgentState(name);
      stateNote = null;
      stateHistory = await getAgentStateHistory(name);
    } catch (err) {
      saveError = err instanceof ApiError ? err.detail : "Could not clear the note";
    }
  }

  async function useVersion(id: number): Promise<void> {
    try {
      stateNote = await restoreAgentState(name, id);
      stateHistory = await getAgentStateHistory(name);
    } catch (err) {
      saveError = err instanceof ApiError ? err.detail : "Could not bring back that version";
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
  function onStrictChange(on: boolean): void {
    if (!form || !agent || on) return;
    if (agent.tools.includes("read_notes") && agent.tools.includes("web_fetch")) {
      form.strict = true; // stays on until the owner confirms
      confirmOff = true;
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

<Page>
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !agent || !form}
    <p class="muted">Loading…</p>
  {:else}
    <Stack gap={8}>
      <header class="head">
        <Button variant="ghost" size="sm" href="/agents">Helpers</Button>
        <div class="titlebar">
          <h1>{agent.name}</h1>
          <StatusDot state={statusDot(agent, runs[0])} />
          <span class="grow"></span>
          <Button disabled={running} onclick={() => void runNow()}>{running ? "Running…" : "Run now"}</Button>
          <Button onclick={() => void startChatWith()}>Chat</Button>
          <Menu
            label="More actions for this helper"
            items={[
              { label: "Duplicate", onselect: () => void duplicate() },
              { label: skillCopied ? "Copied as SKILL.md" : "Copy as SKILL.md", onselect: () => void copySkill() },
            ]}
          >
            {#snippet trigger({ props })}
              <IconButton label="More actions for this helper" {...props}><Ellipsis size={16} strokeWidth={1.5} /></IconButton>
            {/snippet}
          </Menu>
        </div>
        {#if agent.description}<p class="muted">{agent.description}</p>{/if}
        {#if runError}<p class="error" role="alert">{runError}</p>{/if}
      </header>

      {#each modelWarnings as w (w)}<p class="warn" role="note">{w}</p>{/each}

      {#if !agent.enabled}
        <section class="notice" aria-labelledby="turn-on-title">
          <h2 id="turn-on-title">This helper is off.</h2>
          <p class="muted">It will not run on its own until you turn it on. {describeTriggerSentence(agent.trigger)}</p>
          <ul class="grants">
            {#each grants as g (g.tool)}
              <li>
                <span>{g.text}</span>
                {#if g.blocked}<span class="muted"> Turned off in <a href="/settings">Settings</a>.</span>{/if}
              </li>
            {/each}
            <li>Needs your approval before writing: <strong>{form.strict ? "on" : "off"}</strong>.</li>
          </ul>
          <Cluster gap={2}>
            <Button variant="primary" disabled={busy} onclick={() => void turnOn()}>Turn on</Button>
            <Button variant="ghost" disabled={running} onclick={() => void runNow()}>Run once now</Button>
          </Cluster>
        </section>
      {/if}

      <section aria-label="Schedule">
        <dl class="facts">
          <dt>Runs</dt>
          <dd>{describeTrigger(agent.trigger)}</dd>
          <dt>Next run</dt>
          <dd>{schedule?.nextRunAt ? formatStamp(schedule.nextRunAt) : agent.enabled ? "none" : "off"}</dd>
          {#if agent.trigger.kind === "heartbeat"}
            <dt>Last check</dt>
            <dd>{agent.enabled ? describeCheck(schedule?.lastCheckedAt ?? null, schedule?.lastSkipReason ?? null) : "off"}</dd>
          {/if}
          <dt>Last started</dt>
          <dd>{formatStamp(schedule?.lastStartedAt)}</dd>
          {#if schedule?.lastSkipReason && agent.trigger.kind !== "heartbeat"}
            <dt>Last skipped</dt>
            <dd>{schedule.lastSkipReason}</dd>
          {/if}
        </dl>
      </section>

      {#if reach}
        <section aria-label="What this helper can reach">
          <h2>What it can reach</h2>
          <ul class="reach">
            {#each reach.lines as l (l.label)}
              <li><Badge tone={l.on ? "agent" : "neutral"}>{l.label}</Badge><span class="muted">{l.text}</span></li>
            {/each}
          </ul>
          {#if reach.all}<p class="muted">All three together are the risky mix: keep approvals on, and list only sites you trust.</p>{/if}
        </section>
      {/if}

      {#if risky}
        <p class="warn" role="note">
          This helper can read your notes and fetch web pages without asking you first. A web page could try to make it send your notes out. Turn on approvals, or limit the allowed sites.
        </p>
      {/if}

      <section aria-label="Settings">
        <h2>Settings</h2>
        <Stack gap={6}>
          <Stack gap={3}>
            <Switch label="Enabled" bind:checked={form.enabled} />
            <Switch label="Ask me before this helper writes" bind:checked={form.strict} onchange={onStrictChange} />
            <p class="muted">Writes wait in <a href="/approvals">Approvals</a> until you accept them.</p>
          </Stack>

          <Stack gap={2}>
            <h3>When it runs</h3>
            <Cluster gap={2}>
              <span class="w-select">
                <Select bind:value={form.trigger.kind} aria-label="When it runs">
                  <option value="manual">Only when I start it</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="changes">When my notes change</option>
                  {#if form.trigger.kind === "custom"}<option value="custom">Custom schedule</option>{/if}
                </Select>
              </span>
              {#if form.trigger.kind === "weekly"}
                <span class="w-select">
                  <Select value={String(form.trigger.day)} onchange={(e) => form && form.trigger.kind === "weekly" && (form.trigger.day = Number(e.currentTarget.value))} aria-label="Day of the week">
                    {#each DAY_NAMES as d, i (d)}<option value={String(i)}>{d}</option>{/each}
                  </Select>
                </span>
              {/if}
              {#if form.trigger.kind === "daily" || form.trigger.kind === "weekly"}
                <span class="w-time"><Input type="time" bind:value={form.trigger.time} aria-label="Time of day" /></span>
              {/if}
              {#if form.trigger.kind === "changes"}
                <span class="muted">checking every</span>
                <span class="w-narrow"><Input inputmode="numeric" bind:value={form.trigger.minutes} aria-label="Minutes between checks" /></span>
                <span class="muted">minutes</span>
              {/if}
              {#if form.trigger.kind === "custom"}
                <span class="w-select"><Input bind:value={form.trigger.expression} aria-label="Schedule expression" /></span>
              {/if}
            </Cluster>
            {#if problem}<p class="error" role="alert">{problem}</p>{/if}
          </Stack>

          <Stack gap={3}>
            <h3>What it may do</h3>
            {#each TOOLS as t (t)}
              <Checkbox label={TOOL_LABELS[t].label} detail={TOOL_LABELS[t].detail} checked={form.tools.includes(t)} onchange={(on) => toggleTool(t, on)} />
            {/each}
          </Stack>

          {#if form.tools.includes("web_fetch")}
            <Stack gap={2}>
              <h3>Allowed sites</h3>
              {#if form.allowedHosts.length > 0}
                <ul class="hosts">
                  {#each form.allowedHosts as host (host)}
                    <li><code>{host}</code><Button variant="ghost" size="sm" aria-label={`Remove ${host}`} onclick={() => removeHost(host)}>Remove</Button></li>
                  {/each}
                </ul>
              {/if}
              <form class="inline" onsubmit={onAddHost}>
                <Input bind:value={hostInput} placeholder="example.com" aria-label="Add an allowed site" aria-describedby="host-err" autocomplete="off" spellcheck={false} />
                <Button type="submit">Add site</Button>
              </form>
              {#if hostError}<p id="host-err" class="error" role="alert">{hostError}</p>{/if}
              {#if noHostsWarning(agent, form.allowedHosts)}<p class="warn" role="status">{noHostsWarning(agent, form.allowedHosts)}</p>{/if}
              <p class="muted">Exact host names only: no subdomains, no wildcards, no local or private addresses. Every address it fetches is written in its run log.</p>
            </Stack>
          {/if}

          <Field label="Description">
            {#snippet children({ id })}<Input {id} bind:value={form.description} maxlength={280} />{/snippet}
          </Field>

          <details class="advanced" open={missingConnection !== null}>
            <summary>More</summary>
            <Stack gap={4}>
              {#if form.tools.includes("write_notes")}
                <Field label="Only write notes tagged" hint="Tags separated by commas, for example journal. Empty means any note.">
                  {#snippet children({ id, describedby })}<Input {id} aria-describedby={describedby} placeholder="Any note" bind:value={form.writeTags} />{/snippet}
                </Field>
                {#if form.strict && form.writeTags.trim() !== ""}
                  <Switch label="Let it add to these notes without asking" bind:checked={form.autoApproveAppends} />
                  <p class="muted">Only adds to notes that already carry a tag. Text planted in a note or web page could then reach them without your review.</p>
                {/if}
              {/if}
              {#if form.tools.includes("web_fetch")}
                <Switch label="Ask me before it reads a web page" checked={form.approveTools.includes("fetch_url")} onchange={(on: boolean) => toggleApprove("fetch_url", on)} />
              {/if}
              {#if form.tools.includes("call_agents")}
                <Switch label="Ask me before it asks another helper" checked={form.approveTools.includes("call_agent")} onchange={(on: boolean) => toggleApprove("call_agent", on)} />
              {/if}
              <Switch label="Remember where it stopped" bind:checked={form.keepState} />
              <p class="muted">It keeps a short note for its next run and reads it first. The note is not one of your notes.</p>
              {#if stateNote}
                <p class="note-text" aria-label="The helper's saved note">{stateNote.text}</p>
                <Cluster gap={2}>
                  <span class="muted">Saved {formatStamp(stateNote.updatedAt)}.</span>
                  <Button variant="ghost" size="sm" onclick={() => void clearNote()}>Clear note</Button>
                </Cluster>
              {/if}
              {#if stateHistory.length > 0}
                <details class="advanced">
                  <summary>Earlier versions ({stateHistory.length})</summary>
                  <Stack gap={3}>
                    {#each stateHistory as v (v.id)}
                      <Stack gap={1}>
                        <p class="note-text">{v.text}</p>
                        <Cluster gap={2}>
                          <span class="muted">Saved {formatStamp(v.savedAt)}.</span>
                          <Button variant="ghost" size="sm" onclick={() => void useVersion(v.id)}>Use this version</Button>
                        </Cluster>
                      </Stack>
                    {/each}
                  </Stack>
                </details>
              {/if}
              <Field label="Most it may spend per run" hint="In tokens, the unit model providers bill by.">
                {#snippet children({ id })}<span class="w-narrow"><Input {id} inputmode="numeric" bind:value={form.tokenBudget} /></span>{/snippet}
              </Field>
              <Field label="Most it may spend per day" hint="In tokens. Empty means no daily limit.">
                {#snippet children({ id })}<span class="w-narrow"><Input {id} inputmode="numeric" placeholder="No limit" bind:value={form.dailyTokenCap} /></span>{/snippet}
              </Field>
              {#if missingConnection}
                <p class="warn" role="alert">This helper uses the connection "{missingConnection}", which no longer exists, so its runs will fail. Pick another connection below.</p>
              {/if}
              {#if connections.length > 0}
                <Field label="Model connection">
                  {#snippet children({ id })}
                    <Select {id} bind:value={form.connection} onchange={() => void loadModels()}>
                      <option value="">Default connection</option>
                      {#each connections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
                      {#if missingConnection}<option value={missingConnection}>{missingConnection} (removed)</option>{/if}
                    </Select>
                  {/snippet}
                </Field>
              {/if}
              <Field label="Model" hint="Empty uses the connection's default.">
                {#snippet children({ id })}
                  {#if models.length > 0}
                    <Select {id} bind:value={form.model}>
                      <option value="">Connection default</option>
                      {#each models as m (m)}<option value={m}>{m}</option>{/each}
                      {#if form.model !== "" && !models.includes(form.model)}<option value={form.model}>{form.model}</option>{/if}
                    </Select>
                  {:else}
                    <Input {id} bind:value={form.model} />
                  {/if}
                {/snippet}
              </Field>
              <Field label="When started without instructions">
                {#snippet children({ id })}<Input {id} bind:value={form.defaultTask} />{/snippet}
              </Field>
              <Field label="Instructions" hint="What it is for and how it should work, in plain words.">
                {#snippet children({ id })}<Textarea {id} rows={10} bind:value={form.systemPrompt} />{/snippet}
              </Field>
            </Stack>
          </details>

          {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
          <Cluster gap={2}>
            <Button variant={agent.enabled ? "primary" : "quiet"} disabled={busy || !dirty || problem !== null} onclick={() => void save()}>Save changes</Button>
            {#if notice && !dirty}<span class="muted" aria-live="polite">{notice}</span>{/if}
          </Cluster>
        </Stack>
      </section>

      <section aria-label="Saved test tasks">
        <h2>Test tasks</h2>
        <p class="muted">Keep a few sample tasks and run them again after you change the instructions.</p>
        <ul class="tests">
          {#each agent.testTasks ?? [] as t, i (i)}
            <li>
              <span class="test-text">{t}</span>
              <Button variant="ghost" size="sm" onclick={() => void runTest(t)}>Run</Button>
              <Button variant="ghost" size="sm" aria-label="Remove this test task" onclick={() => void saveTests((agent?.testTasks ?? []).filter((_, j) => j !== i))}>Remove</Button>
            </li>
          {/each}
        </ul>
        {#if (agent.testTasks ?? []).length < 5}
          <form class="inline" onsubmit={(e) => { e.preventDefault(); if (newTest.trim() !== "") void saveTests([...(agent?.testTasks ?? []), newTest.trim()]); }}>
            <Input bind:value={newTest} placeholder="A sample task, for example: Summarise yesterday's notes" aria-label="New test task" maxlength={2000} />
            <Button type="submit" disabled={newTest.trim() === ""}>Save task</Button>
          </form>
        {/if}
      </section>

      <section aria-labelledby="runs-title">
        <h2 id="runs-title">Recent runs</h2>
        {#if runs.length === 0}
          <p class="muted">No runs yet.</p>
        {:else}
          <div class="list">
            {#each runs as run (run.id)}
              <Row title={`${run.status} · ${run.trigger}`} meta={formatStamp(run.startedAt)} snippet={`${run.tokensUsed} of ${run.tokenBudget} tokens`} href={`/runs/${run.id}`}>
                {#snippet lead()}<StatusDot state={statusDot({ enabled: true }, run)} label={run.status} />{/snippet}
              </Row>
            {/each}
          </div>
        {/if}
      </section>
    </Stack>
  {/if}
</Page>

<Dialog bind:open={confirmOff} title="Turn off approvals?" description="This helper reads notes and the web. A web page could trick it into writing something or sending your note text to a site you allowed. With approvals on, you check every write first.">
  {#snippet actions()}
    <Button variant="primary" onclick={() => (confirmOff = false)}>Keep approvals on</Button>
    <Button variant="danger" onclick={() => { if (form) form.strict = false; confirmOff = false; }}>Turn off</Button>
  {/snippet}
</Dialog>

<style>
  h1 {
    margin: 0;
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-prose);
    letter-spacing: var(--type-title-tracking);
  }

  h2 {
    margin: 0 0 var(--s-2);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  h3 {
    margin: 0;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  p {
    margin: 0;
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: 100%;
  }

  .grow {
    flex: 1;
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .warn {
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-surface);
    background: var(--danger-fill);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-4) var(--s-5);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
  }

  .notice h2 {
    margin: 0;
  }

  .grants {
    margin: 0;
    padding-left: var(--s-5);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .facts {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: var(--s-2) var(--s-4);
    margin: 0;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .facts dt {
    color: var(--text-2);
  }

  .facts dd {
    margin: 0;
  }

  .reach {
    list-style: none;
    margin: 0 0 var(--s-2);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .reach li {
    display: flex;
    align-items: baseline;
    gap: var(--s-3);
  }

  .hosts,
  .tests {
    list-style: none;
    margin: 0 0 var(--s-2);
    padding: 0;
  }

  .hosts li,
  .tests li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) 0;
  }

  .hosts code {
    flex: 1;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-code);
  }

  .test-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inline {
    display: flex;
    gap: var(--s-2);
  }

  .w-select {
    width: 14rem;
  }

  .w-time {
    width: 8rem;
  }

  .w-narrow {
    display: inline-block;
    width: 6rem;
  }

  .advanced summary {
    margin-bottom: var(--s-3);
    color: var(--text-2);
    cursor: pointer;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  .note-text {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: var(--weight-regular) var(--type-meta-size) / var(--type-body-lh) var(--font-code);
  }
</style>
