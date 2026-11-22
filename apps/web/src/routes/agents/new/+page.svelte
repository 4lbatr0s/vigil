<script lang="ts">
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import type { ToolGrant } from "@vigil/shared";
  import { ApiError, createFromTemplate, getRun, getRunResult, listAgents, listConnections, putAgent, runAgent, startAgentDesign, type Connection } from "$lib/api";
  import { addHost } from "$lib/agent-form";
  import { designToAgent, parseDesign, whenToTrigger, type Design, type When } from "$lib/agent-design";
  import { Button, Checkbox, Cluster, Field, Input, Page, Select, Stack, Textarea } from "$lib/ui";

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

<Page title="Create an agent" width="prose">
  <Stack gap={6}>
    <Button variant="ghost" size="sm" href="/agents">Agents</Button>

    {#if !hasConnection}
      <p class="warn" role="note">No model is connected yet, so the draft cannot be made. <a href="/settings#models">Connect one</a>, or write the agent yourself.</p>
    {/if}

    {#if step === "describe" || step === "drafting"}
      <form onsubmit={draft}>
        <Stack gap={6}>
          <Field label="What should it do?">
            {#snippet children({ id })}
              <Textarea {id} rows={4} bind:value={goal} maxlength={1500} placeholder="For example: Every Friday, read the notes I changed this week and write a short recap of what I finished and what is still open." disabled={step === "drafting"} />
            {/snippet}
          </Field>

          <Stack gap={2}>
            <h2>When should it run?</h2>
            <Cluster gap={2}>
              <span class="w-select">
                <Select bind:value={when} aria-label="When it runs">
                  <option value="manual">Only when I start it</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="changes">When my notes change</option>
                </Select>
              </span>
              {#if when === "weekly"}
                <span class="w-select">
                  <Select value={String(day)} onchange={(e) => (day = Number(e.currentTarget.value))} aria-label="Day of the week">
                    {#each DAY_NAMES as d, i (d)}<option value={String(i)}>{d}</option>{/each}
                  </Select>
                </span>
              {/if}
              {#if when === "daily" || when === "weekly"}<span class="w-time"><Input type="time" bind:value={time} aria-label="Time of day" /></span>{/if}
              {#if when === "changes"}
                <span class="muted">check every</span>
                <span class="w-narrow"><Input inputmode="numeric" bind:value={minutes} aria-label="Minutes between checks" /></span>
                <span class="muted">minutes</span>
              {/if}
            </Cluster>
          </Stack>

          <Stack gap={3}>
            <h2>What may it touch?</h2>
            <Checkbox label="Read my notes" detail="List, search and read them." bind:checked={canRead} />
            <Checkbox label="Write notes" detail="You approve each write first, and can undo it." bind:checked={canWrite} />
            <Checkbox label="Fetch web pages" detail="Only from sites you list." bind:checked={canWeb} />
            {#if canWeb}
              <Stack gap={2}>
                {#if hosts.length > 0}
                  <ul class="hosts">
                    {#each hosts as h (h)}<li><code>{h}</code><Button variant="ghost" size="sm" aria-label={`Remove ${h}`} onclick={() => (hosts = hosts.filter((x) => x !== h))}>Remove</Button></li>{/each}
                  </ul>
                {/if}
                <div class="inline">
                  <Input bind:value={hostInput} placeholder="example.com" aria-label="Add an allowed site" autocomplete="off" spellcheck={false} onkeydown={(e) => { if (e.key === "Enter") addSite(e); }} />
                  <Button onclick={addSite}>Add site</Button>
                </div>
                {#if hostError}<p class="error" role="alert">{hostError}</p>{/if}
              </Stack>
            {/if}
          </Stack>

          <Cluster gap={2}>
            <Button variant="primary" type="submit" disabled={busy || step === "drafting" || goal.trim().length < 10 || !hasConnection}>{step === "drafting" ? "Drafting…" : "Draft it for me"}</Button>
            <Button variant="ghost" onclick={writeMyself}>I will write it myself</Button>
          </Cluster>
          {#if step === "drafting"}<p class="muted" aria-live="polite">The model is drafting the instructions. A model on your own computer can take a minute or two. Nothing is saved yet.</p>{/if}
        </Stack>
      </form>
    {:else if step === "review"}
      <p class="muted">Check the draft and change anything. The agent is created switched off; you turn it on from its page.</p>
      <Stack gap={4}>
        <Field label="Name">
          {#snippet children({ id })}<Input {id} bind:value={design.name} maxlength={40} placeholder="friday-recap" />{/snippet}
        </Field>
        <Field label="Description">
          {#snippet children({ id })}<Input {id} bind:value={design.description} maxlength={280} />{/snippet}
        </Field>
        <Field label="Instructions">
          {#snippet children({ id })}<Textarea {id} rows={12} bind:value={design.systemPrompt} />{/snippet}
        </Field>
        <Field label="When started without instructions">
          {#snippet children({ id })}<Input {id} bind:value={design.defaultTask} />{/snippet}
        </Field>
        <ul class="summary">
          <li>Runs: <strong>{when === "manual" ? "only when you start it" : when === "daily" ? `every day at ${time}` : when === "weekly" ? `every ${DAY_NAMES[day]} at ${time}` : `when your notes change (every ${minutes} min)`}</strong></li>
          <li>May: <strong>{tools.length === 0 ? "nothing but think" : tools.map((t) => (t === "read_notes" ? "read notes" : t === "write_notes" ? "write notes (with your approval)" : "fetch web pages")).join(", ")}</strong></li>
        </ul>
        {#if message}<p class="error" role="alert">{message}</p>{/if}
        <Cluster gap={2}>
          <Button variant="primary" disabled={busy || design.systemPrompt.trim().length < 20} onclick={() => void create()}>Create agent</Button>
          <Button disabled={busy || design.systemPrompt.trim().length < 20 || !hasConnection} onclick={() => void create(true)}>Create and try it once</Button>
          <Button variant="ghost" onclick={() => (step = "describe")}>Back</Button>
        </Cluster>
      </Stack>
    {:else}
      <p class="error" role="alert">{message}</p>
      <Cluster gap={2}>
        <Button variant="primary" onclick={() => (step = "describe")}>Try again</Button>
        <Button variant="ghost" onclick={writeMyself}>I will write it myself</Button>
      </Cluster>
    {/if}
  </Stack>
</Page>

<style>
  h2 {
    margin: 0;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  p {
    margin: 0;
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

  .hosts {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .hosts li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) 0;
  }

  .hosts code {
    flex: 1;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-code);
  }

  .inline {
    display: flex;
    gap: var(--s-2);
  }

  .summary {
    margin: 0;
    padding-left: var(--s-5);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
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
</style>
