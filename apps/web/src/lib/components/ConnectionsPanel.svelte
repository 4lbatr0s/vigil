<script lang="ts">
  import { goto } from "$app/navigation";
  import { slugify } from "@vigil/shared";
  import GraphCanvas from "$lib/components/graph/GraphCanvas.svelte";
  import { getGraph, getNoteLinks, putNote, type NoteLinks } from "$lib/api";
  import { formatStamp } from "$lib/format";
  import type { GraphApi } from "$lib/graph-model";
  import { Badge, Button, Row, Select, Tabs } from "$lib/ui";

  /**
   * What the open note is connected to: a small graph of it and its neighbours, the same as lists, and the agents
   * that touched it. Shown beside the note so related notes are one click away while writing.
   */
  let { noteId, signature = "", onclose }: { noteId: string; /** changes when notes change, to refresh */ signature?: string; onclose: () => void } = $props();

  let tab = $state("graph");
  let hops = $state("1");
  let graph = $state<GraphApi | null>(null);
  let links = $state<NoteLinks | null>(null);
  let failed = $state(false);
  let noWebgl = $state(false);
  let error = $state("");

  $effect(() => {
    const id = noteId;
    const depth = Number(hops);
    void signature;
    let stale = false;
    getGraph({ focus: id, hops: depth })
      .then((g) => {
        if (!stale) {
          graph = g;
          failed = false;
        }
      })
      .catch(() => {
        if (!stale) failed = true;
      });
    return () => {
      stale = true;
    };
  });

  $effect(() => {
    const id = noteId;
    void signature;
    let stale = false;
    getNoteLinks(id)
      .then((l) => {
        if (!stale) links = l;
      })
      .catch(() => {
        if (!stale) links = null;
      });
    return () => {
      stale = true;
    };
  });

  const agentEdges = $derived(graph ? graph.edges.filter((e) => e.kind !== "link" && e.target === noteId) : []);
  const alone = $derived(graph !== null && graph.nodes.filter((n) => n.kind === "note").length <= 1);

  async function create(title: string): Promise<void> {
    error = "";
    try {
      const note = await putNote(slugify(title) || title, { title, body: "" });
      await goto(`/?note=${encodeURIComponent(note.id)}`);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not create the note";
    }
  }

  function openFromGraph(id: string | null): void {
    if (id === null || id === noteId || id.startsWith("agent:")) return;
    const node = graph?.nodes.find((n) => n.id === id);
    if (node?.ghost) void create(node.title);
    else void goto(`/?note=${encodeURIComponent(id)}`);
  }
</script>

<aside class="connections" aria-label="Connections">
  <header>
    <h2>Connections</h2>
    <Button variant="ghost" size="sm" onclick={onclose}>Close</Button>
  </header>

  <Tabs
    bind:value={tab}
    tabs={[
      { value: "graph", label: "Graph" },
      { value: "links", label: "Links" },
      { value: "agents", label: "Agents" },
    ]}
  >
    {#snippet panel(which)}
      {#if which === "graph"}
        <div class="controls">
          <span class="depth">
            <Select aria-label="How far to look" bind:value={hops}>
              <option value="1">Direct links</option>
              <option value="2">Two steps away</option>
            </Select>
          </span>
        </div>
        {#if failed}
          <p class="muted">Could not load the connections.</p>
        {:else if graph === null}
          <p class="muted">Loading…</p>
        {:else if alone}
          <p class="muted">No links yet. Link to another note with [[double brackets]] and it appears here.</p>
        {:else if noWebgl}
          <p class="muted">Your browser cannot draw the graph. Use the Links tab.</p>
        {:else}
          <div class="picture">
            <GraphCanvas data={graph} mode="local" focusId={noteId} onselect={openFromGraph} onfail={() => (noWebgl = true)} />
          </div>
          <p class="muted">Click a note to open it. A pale dot is a note you linked to but have not written yet.</p>
        {/if}
      {:else if which === "links"}
        {#if links === null}
          <p class="muted">Loading…</p>
        {:else}
          <section>
            <h3>Links to <Badge>{links.outgoing.length}</Badge></h3>
            {#if links.outgoing.length === 0}<p class="muted">This note does not link to another note.</p>{/if}
            <div class="rows">
              {#each links.outgoing as o (o.id)}
                {#if o.ghost}
                  <p class="ghost"><span>{o.title}</span><Button size="sm" onclick={() => void create(o.title)}>Create note</Button></p>
                {:else}
                  <Row title={o.title} href={`/?note=${encodeURIComponent(o.id)}`} />
                {/if}
              {/each}
            </div>
          </section>
          <section>
            <h3>Linked from <Badge>{links.backlinks.length}</Badge></h3>
            {#if links.backlinks.length === 0}<p class="muted">No other note links here yet.</p>{/if}
            <div class="rows">
              {#each links.backlinks as b (b.id)}
                <Row title={b.title || b.id} snippet={b.snippet} href={`/?note=${encodeURIComponent(b.id)}`} wrap />
              {/each}
            </div>
          </section>
          <section>
            <h3>Mentioned in <Badge>{links.mentions.length}</Badge></h3>
            {#if links.mentions.length === 0}
              <p class="muted">No other note mentions this title without linking to it.</p>
            {:else}
              <p class="muted">These notes use this title but do not link to it.</p>
            {/if}
            <div class="rows">
              {#each links.mentions as m (m.id)}
                <Row title={m.title || m.id} snippet={m.snippet} href={`/?note=${encodeURIComponent(m.id)}`} wrap />
              {/each}
            </div>
          </section>
          {#if error}<p class="error" role="alert">{error}</p>{/if}
        {/if}
      {:else}
        {#if graph === null}
          <p class="muted">Loading…</p>
        {:else if agentEdges.length === 0}
          <p class="muted">No agent has read or written this note in the last 90 days.</p>
        {:else}
          <div class="rows">
            {#each agentEdges as e, i (i)}
              <Row
                title={`${e.source.replace(/^agent:/, "")} ${e.kind === "agent-wrote" ? "wrote" : "read"} this note`}
                meta={e.at ? formatStamp(e.at) : ""}
                href={e.runId ? `/runs/${encodeURIComponent(e.runId)}` : `/agents/${encodeURIComponent(e.source.replace(/^agent:/, ""))}`}
              />
            {/each}
          </div>
        {/if}
      {/if}
    {/snippet}
  </Tabs>
</aside>

<style>
  .connections {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    height: 100%;
    padding: var(--s-4);
    overflow-y: auto;
    background: var(--paper);
    box-shadow: inset 1px 0 0 var(--line-soft);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: var(--s-4) 0 var(--s-1);
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  section:first-child h3 {
    margin-top: 0;
  }

  .controls {
    display: flex;
    margin-bottom: var(--s-2);
  }

  .depth {
    width: 12rem;
  }

  .picture {
    position: relative;
    height: 320px;
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    overflow: hidden;
  }

  .muted {
    margin: var(--s-2) 0 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    margin: 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .rows {
    margin: 0 calc(var(--s-3) * -1);
  }

  .ghost {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    margin: 0;
    padding: var(--s-1) var(--s-3);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
