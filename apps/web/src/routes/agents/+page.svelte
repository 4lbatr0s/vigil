<script lang="ts">
  import Illustration from "$lib/components/Illustration.svelte";
  import { groupTemplates } from "$lib/template-groups";
  import Lamp from "@lucide/svelte/icons/lamp";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type { Agent, AgentTemplate, Run } from "@vigil/shared";
  import { createFromTemplate, getLlmStatus, getSchedule, listAgents, listRuns, listTemplates, type LlmStatus } from "$lib/api";
  import { formatStamp } from "$lib/format";
  import { refreshOnLive } from "$lib/live";
  import { describeTrigger, lastRunByAgent, statusDot } from "$lib/schedule";
  import StatusDot from "$lib/components/StatusDot.svelte";

  let agents = $state<Agent[]>([]);
  let runs = $state<Run[]>([]);
  let nextRuns = $state<Record<string, string | null>>({});
  let templates = $state<AgentTemplate[]>([]);
  let llm = $state<LlmStatus | null>(null);
  let loaded = $state(false);
  let error = $state("");
  let adding = $state<string | null>(null);

  const last = $derived(lastRunByAgent(runs));

  async function refreshRuns(): Promise<void> {
    try {
      runs = await listRuns({ limit: 200 });
      error = "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load runs";
    }
  }

  onMount(() => {
    void (async () => {
      try {
        [agents, templates, llm] = await Promise.all([listAgents(), listTemplates(), getLlmStatus()]);
        const entries = await Promise.all(agents.map(async (a) => [a.name, (await getSchedule(a.name)).nextRunAt] as const));
        nextRuns = Object.fromEntries(entries);
      } catch (err) {
        error = err instanceof Error ? err.message : "Could not load agents";
      } finally {
        loaded = true;
      }
    })();
    return refreshOnLive(refreshRuns, ["run"], 3000);
  });

  const llmReady = $derived(llm !== null && llm.model !== null && (llm.provider === "ollama" || llm.hasKey));

  async function add(id: string): Promise<void> {
    adding = id;
    try {
      const agent = await createFromTemplate(id);
      await goto(`/agents/${agent.name}`);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not add the agent";
      adding = null;
    }
  }
</script>

<svelte:head><title>Agents · Vigil</title></svelte:head>

<main class="page">
  <div class="titlebar">
    <h1>Agents</h1>
    <a class="primary-link" href="/agents/new">Create an agent</a>
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else if agents.length === 0}
    <section class="empty">
      <Illustration kind="lantern" />
      <p class="empty-title">No agents yet</p>
      <p class="muted">Pick one below. It stays off until you turn it on.</p>
    </section>
  {:else}
    <ul class="ledger" aria-label="Agents">
      {#each agents as agent (agent.name)}
        {@const lastRun = last.get(agent.name)}
        <li>
          <a class="row" href={`/agents/${agent.name}`}>
            <StatusDot state={statusDot(agent, lastRun)} />
            <span class="stamp">{formatStamp(lastRun?.startedAt)}</span>
            <span class="name"><span class="glyph" class:lit={agent.enabled} aria-hidden="true"><Lamp size={16} strokeWidth={1.5} /></span>{agent.name}{#if !agent.enabled}<span class="off"> · off</span>{/if}</span>
            <span class="mono">{describeTrigger(agent.trigger)}</span>
            <span class="mono next">{agent.enabled && nextRuns[agent.name] ? `next ${formatStamp(nextRuns[agent.name])}` : ""}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if loaded}
    <section class="gallery" aria-labelledby="gallery-title">
      <h2 id="gallery-title">Add an agent</h2>
      {#each groupTemplates(templates) as g (g.id)}
        <h3 class="group">{g.title}{#if g.blurb}<span class="blurb"> · {g.blurb}</span>{/if}</h3>
        <ul class="ledger">
          {#each g.items as t (t.id)}
            <li class="template">
              <div class="template-text">
                <span class="name">{t.title}</span>
                <span class="summary">{t.summary}</span>
                <span class="needs">
                  {#if t.needs.includes("llm")}{llmReady ? "Model: ready." : "Model: not set up yet, see Settings."}{/if}
                  {#if t.needs.includes("web")} Web: you choose the allowed sites.{/if}
                </span>
              </div>
              <button type="button" class="add" disabled={adding !== null} onclick={() => void add(t.id)}>
                {adding === t.id ? "Adding…" : "Add"}
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  {/if}
</main>

<style>
  .titlebar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  .primary-link {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--bg);
    font-size: var(--text-ui);
    text-decoration: none;
  }
  .page {
    padding: var(--space-6);
    max-width: 960px;
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
    margin-bottom: var(--space-4);
  }
  h2 {
    font-family: var(--font-chrome);
    font-size: var(--text-ui);
    font-weight: 600;
    margin: var(--space-8) 0 var(--space-2);
  }
  .muted {
    color: var(--ink-muted);
  }
  .error {
    color: var(--err-ink);
    margin-bottom: var(--space-4);
  }
  .empty {
    padding: var(--space-12) 0;
    text-align: center;
  }
  .empty-title {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    margin-bottom: var(--space-2);
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
    grid-template-columns: 12px 120px 1fr 220px 160px;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-2);
    color: inherit;
    text-decoration: none;
  }
  .row:hover {
    background: var(--surface);
  }
  .row :global(.dot) {
    align-self: center;
  }
  .stamp,
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .name {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
  }
  .off {
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .template {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-2);
  }
  .template-text {
    display: grid;
    gap: var(--space-1);
  }
  .summary {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .needs {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .add {
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
    flex: none;
  }
  .add:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @media (max-width: 800px) {
    .row {
      grid-template-columns: 12px 1fr;
    }
    .stamp,
    .row .mono {
      grid-column: 2;
    }
  }
  /* The lantern is lit (amber) while the agent is on: amber means agent life, so it stays only here. */
  .glyph {
    display: inline-block;
    margin-right: var(--space-2);
    vertical-align: -2px;
    color: var(--ink-muted);
  }

  .glyph.lit {
    color: var(--amber-ink);
  }
  .group {
    margin: var(--space-6) 0 var(--space-1);
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    font-weight: 600;
  }

  .blurb {
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    font-weight: 400;
    color: var(--ink-muted);
  }
</style>
