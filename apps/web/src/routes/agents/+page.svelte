<script lang="ts">
  import { groupTemplates, templateTags } from "$lib/template-groups";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type { Agent, AgentTemplate, Run } from "@vigil/shared";
  import { ApiError, createFromTemplate, getLlmStatus, importSkill, getSchedule, listAgents, listRuns, listTemplates, type LlmStatus } from "$lib/api";
  import { formatStamp } from "$lib/format";
  import { refreshOnLive } from "$lib/live";
  import { describeTrigger, lastRunByAgent, statusDot } from "$lib/schedule";
  import { bannerFor } from "$lib/settings-form";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { Badge, Button, Cluster, Dialog, EmptyState, Field, Input, Page, Row, Stack, Textarea } from "$lib/ui";

  let agents = $state<Agent[]>([]);
  let runs = $state<Run[]>([]);
  let nextRuns = $state<Record<string, string | null>>({});
  let templates = $state<AgentTemplate[]>([]);
  let llm = $state<LlmStatus | null>(null);
  let loaded = $state(false);
  let error = $state("");
  let adding = $state<string | null>(null);
  let find = $state("");
  const shownGroups = $derived(
    groupTemplates(templates)
      .map((g) => ({ ...g, items: g.items.filter((t) => find.trim() === "" || `${t.title} ${t.summary} ${templateTags(t).join(" ")}`.toLowerCase().includes(find.trim().toLowerCase())) }))
      .filter((g) => g.items.length > 0),
  );

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

  const llmReady = $derived(llm !== null && bannerFor(llm, null) === null);

  let skillOpen = $state(false);
  let skillText = $state("");
  let importing = $state(false);
  let importError = $state("");
  /** A SKILL.md pasted here becomes an agent with no tools that is switched off; the person grants what it needs. */
  async function addSkill(): Promise<void> {
    importError = "";
    importing = true;
    try {
      const agent = await importSkill(skillText);
      await goto(`/agents/${agent.name}`);
    } catch (err) {
      importError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not import the skill";
      importing = false;
    }
  }

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

<Page title="Agents" width="wide">
  {#snippet actions()}
    <Button variant="primary" href="/agents/new">Create an agent</Button>
  {/snippet}

  <Stack gap={8}>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if !loaded}
      <p class="muted">Loading…</p>
    {:else if agents.length === 0}
      <EmptyState title="No agents yet. Create one, or add a ready-made agent below." />
    {:else}
      <div class="list" role="list" aria-label="Agents">
        {#each agents as agent (agent.name)}
          {@const lastRun = last.get(agent.name)}
          <div role="listitem">
            <Row
              title={agent.enabled ? agent.name : `${agent.name} (off)`}
              meta={lastRun ? formatStamp(lastRun.startedAt) : "never run"}
              snippet={`${describeTrigger(agent.trigger)}${agent.enabled && nextRuns[agent.name] ? ` · next ${formatStamp(nextRuns[agent.name])}` : ""}`}
              href={`/agents/${agent.name}`}
            >
              {#snippet lead()}<StatusDot state={statusDot(agent, lastRun)} />{/snippet}
            </Row>
          </div>
        {/each}
      </div>
    {/if}

    {#if loaded}
      <section aria-labelledby="gallery-title">
        <Cluster align="between">
          <h2 id="gallery-title">Ready-made agents</h2>
          <Button variant="ghost" onclick={() => (skillOpen = true)}>Import a skill</Button>
        </Cluster>
        <div class="find"><Input type="search" bind:value={find} placeholder="Find one: recall, digest, writes notes" aria-label="Find a ready-made agent" /></div>
        {#each shownGroups as g (g.id)}
          <h3>{g.title}{#if g.blurb}<span class="blurb">{g.blurb}</span>{/if}</h3>
          <ul class="templates">
            {#each g.items as t (t.id)}
              <li class="template">
                <div class="template-text">
                  <span class="name">{t.title}</span>
                  <span class="summary">{t.summary}</span>
                  <span class="tags">{#each templateTags(t) as tag (tag)}<Badge>{tag}</Badge>{/each}</span>
                  {#if (t.needs.includes("llm") && !llmReady) || t.needs.includes("web")}
                    <span class="summary">
                      {#if t.needs.includes("llm") && !llmReady}<a href="/settings#models">Connect a model first</a>.{/if}
                      {#if t.needs.includes("web")} You choose the allowed sites.{/if}
                    </span>
                  {/if}
                </div>
                <Button disabled={adding !== null} onclick={() => void add(t.id)}>{adding === t.id ? "Adding…" : "Add"}</Button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Nothing matches "{find}".</p>
        {/each}
      </section>
    {/if}
  </Stack>
</Page>

<Dialog bind:open={skillOpen} title="Import a skill" description="Paste a SKILL.md from another tool. Only its words come in: the agent has no tools, is switched off and asks before it writes.">
  <Field label="SKILL.md text" error={importError || undefined}>
    {#snippet children({ id, describedby, invalid })}
      <Textarea {id} aria-describedby={describedby} {invalid} rows={8} bind:value={skillText} placeholder={"---\nname: my-skill\ndescription: What it is for\n---\n\nInstructions…"} />
    {/snippet}
  </Field>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (skillOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={importing || skillText.trim() === ""} onclick={() => void addSkill()}>{importing ? "Importing…" : "Import skill"}</Button>
  {/snippet}
</Dialog>

<style>
  h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  h3 {
    margin: var(--s-6) 0 var(--s-1);
    font: var(--weight-strong) var(--type-body-size) / var(--type-body-lh) var(--font-ui);
  }

  .blurb {
    margin-left: var(--s-2);
    color: var(--text-2);
    font-weight: var(--weight-regular);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  .find {
    max-width: 24rem;
    margin: var(--s-3) 0 var(--s-2);
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

  .templates {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .template {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--s-4);
    padding: var(--s-3) 0;
    box-shadow: 0 1px 0 var(--line-soft);
  }

  .template-text {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }

  .name {
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .summary {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
</style>
