<script lang="ts">
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import type { ToolGrant } from "@vigil/shared";
  import { ApiError, createFromTemplate, getRun, getRunResult, listAgents, listConnections, putAgent, runAgent, startAgentDesign, type Connection } from "$lib/api";
  import { addHost } from "$lib/agent-form";
  import { designToAgent, parseDesign, whenToTrigger, type Design, type When } from "$lib/agent-design";

  type Step = "describe" | "drafting" | "review" | "error";

  let step = $state<Step>("describe");
  let goal = $state("");
  let when = $state<When>("manual");
  let time = $state("07:00");
  let day = $state(1);
  let minutes = $state("30");
  let canRead = $state(true);
  let canWrite = $state(false);
  let canWeb = $state(false);
  let hosts = $state<string[]>([]);
  let hostInput = $state("");
  let hostError = $state("");
  let design = $state<Design>({ name: "", description: "", systemPrompt: "", defaultTask: "Do your job now." });
  let message = $state("");
  let busy = $state(false);
  let taken: string[] = [];
  let hasConnection = $state(true);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const tools = $derived<ToolGrant[]>([...(canRead ? (["read_notes"] as const) : []), ...(canWrite ? (["write_notes"] as const) : []), ...(canWeb ? (["web_fetch"] as const) : [])]);
  const triggerNow = $derived(whenToTrigger(when, time, day, Number(minutes)));

  onDestroy(() => clearTimeout(timer));
  $effect(() => {
    void listConnections().then((c: Connection[]) => (hasConnection = c.length > 0)).catch(() => (hasConnection = true));
  });

  function fail(text: string): void {
    message = text;
    step = "error";
  }

  function addSite(event: Event): void {
    event.preventDefault();
    const r = addHost(hosts, hostInput);
    if (r.ok === false) {
      hostError = r.message;
      return;
    }
    hosts = r.hosts;
    hostInput = "";
    hostError = "";
  }

  /** Starts the designer (made and switched on here, because you asked for a draft) and waits for its reply. */
  async function draft(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      let designer = (await listAgents()).find((a) => a.name === "agent-designer");
      if (!designer) designer = await createFromTemplate("agent-designer");
      if (!designer.enabled) await putAgent({ ...designer, enabled: true });
      taken = (await listAgents()).map((a) => a.name);
      step = "drafting";
      await wait((await startAgentDesign(goal.trim(), tools)).id);
    } catch (err) {
      fail(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the draft");
    } finally {
      busy = false;
    }
  }

  async function wait(runId: string): Promise<void> {
    const { run } = await getRun(runId);
    if (run.status === "running") {
      timer = setTimeout(() => void wait(runId).catch((e) => fail(e instanceof Error ? e.message : "Lost track of the draft")), 1500);
      return;
    }
    if (run.status !== "succeeded") {
      fail(run.error ?? `The designer stopped: ${run.status}`);
      return;
    }
    const parsed = parseDesign((await getRunResult(runId)).text ?? "");
    if (parsed.ok === false) {
      fail(parsed.message);
      return;
    }
    design = parsed.design;
    step = "review";
  }

  function writeMyself(): void {
    design = { name: "", description: "", systemPrompt: "", defaultTask: "Do your job now." };
    step = "review";
  }

  async function create(tryIt = false): Promise<void> {
    if (busy || design.systemPrompt.trim().length < 20) return;
    busy = true;
    message = "";
    try {
      const agent = designToAgent({ design: { ...design, name: design.name || "new-agent" }, tools, trigger: triggerNow, hosts, taken: (await listAgents()).map((a) => a.name) });
      await putAgent(agent);
      // "Try it once" runs the new agent a single time while it is still switched off; the result is on its page.
      if (tryIt) await runAgent(agent.name);
      await goto(`/agents/${agent.name}`);
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not create the agent";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>New agent · Vigil</title></svelte:head>

<main class="page">
  <p class="crumb"><a href="/agents">Agents</a> / New</p>
  <h1>Create an agent</h1>

  {#if !hasConnection}
    <p class="warn" role="note">No model is connected yet, so the draft cannot be made. <a href="/settings#models">Connect one</a>, or write the agent yourself below.</p>
  {/if}

  {#if step === "describe" || step === "drafting"}
    <form onsubmit={draft}>
      <label class="field">
        <span>What should it do?</span>
        <textarea rows="4" bind:value={goal} maxlength="1500" placeholder="For example: Every Friday, read the notes I changed this week and write a short recap with what I finished and what is still open." disabled={step === "drafting"}></textarea>
      </label>

      <fieldset class="field">
        <legend>When should it run?</legend>
        <div class="row">
          <select bind:value={when} aria-label="When it runs">
            <option value="manual">Only when I start it</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="changes">When my notes change</option>
          </select>
          {#if when === "weekly"}
            <select bind:value={day} aria-label="Day of the week">
              {#each DAY_NAMES as d, i (d)}<option value={i}>{d}</option>{/each}
            </select>
          {/if}
          {#if when === "daily" || when === "weekly"}<input type="time" bind:value={time} aria-label="Time of day" />{/if}
          {#if when === "changes"}
            <span class="hint">check every</span>
            <input type="text" inputmode="numeric" class="narrow" bind:value={minutes} aria-label="Minutes between checks" />
            <span class="hint">minutes</span>
          {/if}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>What may it touch?</legend>
        <label class="tool"><input type="checkbox" bind:checked={canRead} /> <span><strong>Read my notes</strong> <span class="hint">list, search and read them</span></span></label>
        <label class="tool"><input type="checkbox" bind:checked={canWrite} /> <span><strong>Write notes</strong> <span class="hint">you approve each write first, and can undo it</span></span></label>
        <label class="tool"><input type="checkbox" bind:checked={canWeb} /> <span><strong>Fetch web pages</strong> <span class="hint">only from sites you list</span></span></label>
        {#if canWeb}
          <div class="sites">
            <ul class="chips">
              {#each hosts as h (h)}<li class="chip">{h} <button type="button" class="x" aria-label={`Remove ${h}`} onclick={() => (hosts = hosts.filter((x) => x !== h))}>×</button></li>{/each}
            </ul>
            <div class="row">
              <input type="text" bind:value={hostInput} placeholder="example.com" aria-label="Add an allowed site" autocomplete="off" spellcheck="false" onkeydown={(e) => { if (e.key === "Enter") addSite(e); }} />
              <button type="button" class="ghost" onclick={addSite}>Add</button>
            </div>
            {#if hostError}<span class="error" role="alert">{hostError}</span>{/if}
          </div>
        {/if}
      </fieldset>

      <div class="row">
        <button type="submit" class="primary" disabled={busy || step === "drafting" || goal.trim().length < 10 || !hasConnection}>{step === "drafting" ? "Drafting…" : "Draft it for me"}</button>
        <button type="button" class="ghost" onclick={writeMyself}>I will write it myself</button>
      </div>
      {#if step === "drafting"}<p class="muted" aria-live="polite">The model is drafting the instructions. A model on your own computer can take a minute or two. Nothing is saved yet.</p>{/if}
    </form>
  {:else if step === "review"}
    <p class="muted">Check the draft and change anything. The agent is created switched off; you turn it on from its page.</p>
    <div class="form">
      <label class="field"><span>Name</span><input type="text" bind:value={design.name} maxlength="40" class="mono" placeholder="friday-recap" /></label>
      <label class="field"><span>Description</span><input type="text" bind:value={design.description} maxlength="280" /></label>
      <label class="field"><span>Instructions</span><textarea rows="12" bind:value={design.systemPrompt}></textarea></label>
      <label class="field"><span>What it does when started without instructions</span><input type="text" bind:value={design.defaultTask} /></label>
      <ul class="summary">
        <li>Runs: <strong>{when === "manual" ? "only when you start it" : when === "daily" ? `every day at ${time}` : when === "weekly" ? `every ${DAY_NAMES[day]} at ${time}` : `when your notes change (every ${minutes} min)`}</strong></li>
        <li>May: <strong>{tools.length === 0 ? "nothing but think" : tools.map((t) => (t === "read_notes" ? "read notes" : t === "write_notes" ? "write notes (with your approval)" : "fetch web pages")).join(", ")}</strong></li>
      </ul>
      {#if message}<p class="error" role="alert">{message}</p>{/if}
      <div class="row">
        <button type="button" class="primary" disabled={busy || design.systemPrompt.trim().length < 20} onclick={() => void create()}>Create agent</button>
        <button type="button" class="ghost" disabled={busy || design.systemPrompt.trim().length < 20 || !hasConnection} onclick={() => void create(true)} title="Creates it switched off and runs it once so you can see what it does">Create and try it once</button>
        <button type="button" class="ghost" onclick={() => (step = "describe")}>Back</button>
      </div>
    </div>
  {:else}
    <p class="error" role="alert">{message}</p>
    <div class="row">
      <button type="button" class="primary" onclick={() => (step = "describe")}>Try again</button>
      <button type="button" class="ghost" onclick={writeMyself}>I will write it myself</button>
    </div>
  {/if}
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 720px;
    display: grid;
    gap: var(--space-4);
  }
  .crumb {
    font-size: var(--text-label);
  }
  .crumb a {
    color: var(--ink-muted);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
  }
  form,
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .field,
  fieldset.field {
    display: grid;
    gap: var(--space-2);
    border: 0;
    padding: 0;
    margin: 0;
  }
  .field > span,
  legend {
    padding: 0;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  textarea,
  input[type="text"],
  input[type="time"],
  select {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  textarea {
    resize: vertical;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .narrow {
    width: 5rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .tool {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }
  .hint,
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .sites {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-6);
  }
  .chips {
    list-style: none;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    padding: 0 var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: var(--text-label);
  }
  .x {
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .summary {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-label);
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
  .warn {
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: var(--text-label);
  }
  .error {
    color: var(--err-ink);
  }
</style>
