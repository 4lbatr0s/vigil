<script lang="ts">
import { noteHref } from "$lib/links";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { slugify } from "@vigil/shared";
  import { createCanvas, getGraph, putNote, saveCanvas } from "$lib/api";
  import { ringBoard } from "$lib/canvas";
  import GraphCanvas from "$lib/components/graph/GraphCanvas.svelte";
  import { refreshOnLive } from "$lib/live";
  import { formatStamp } from "$lib/format";
  import { NO_FILTERS, agentsTouching, attention, filterGraph, groupByConnections, memoryLine, tagCounts, type GraphApi, type GraphFilters, type GraphNodeData } from "$lib/graph-model";
  import { Badge, Button, Cluster, Input, Row, Select } from "$lib/ui";

  type Lens = "tags" | "memory" | "agents";

  let data = $state<GraphApi | null>(null);
  let error = $state("");
  let loading = $state(true);
  let listView = $state(false);
  let webgl = $state(true);
  let lens = $state<Lens>("tags");
  let glow = $state(false);
  let query = $state("");
  let filters = $state<GraphFilters>({ ...NO_FILTERS });
  let selected = $state<string | null>(null);
  let attentionOpen = $state(false);

  const shown = $derived(data ? filterGraph(data, filters) : null);
  const tags = $derived(data ? tagCounts(data) : []);
  const todo = $derived(shown ? attention(shown) : null);
  const selectedNode = $derived(shown?.nodes.find((n) => n.id === selected) ?? null);
  const groups = $derived(shown ? groupByConnections(shown) : []);
  const emptyGraph = $derived(data !== null && data.nodes.filter((n) => n.kind === "note").length < 2);
  const touches = $derived(selected && data ? data.edges.filter((e) => e.kind !== "link" && (e.target === selected || e.source === selected)) : []);
  const backlinkIds = $derived(selected && data ? data.edges.filter((e) => e.kind === "link" && e.target === selected).map((e) => e.source) : []);
  const titleOf = (id: string): string => data?.nodes.find((n) => n.id === id)?.title ?? id;
  const filtered = $derived(filters.tag !== null || filters.orphansOnly || filters.hideGhosts || filters.minLinks > 0);

  function hasWebgl(): boolean {
    try {
      const c = document.createElement("canvas");
      return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  async function load(): Promise<void> {
    try {
      data = await getGraph();
      error = "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load the graph";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    webgl = hasWebgl();
    listView = !webgl;
    void load();
    // Notes and agent runs change while the page is open: the picture follows, and keeps its place.
    return refreshOnLive(load, ["note", "run"], 20_000);
  });

  function fail(): void {
    webgl = false;
    listView = true;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (selected) selected = null;
    else if (query) query = "";
  }

  function openNote(id: string): void {
    void goto(noteHref(id));
  }

  function openNode(id: string): void {
    if (id.startsWith("agent:")) void goto(`/agents/${encodeURIComponent(id.slice(6))}`);
    else openNote(id);
  }

  /** A link to a note that does not exist yet: write it now, empty, and open it. */
  async function createGhost(node: GraphNodeData): Promise<void> {
    try {
      const note = await putNote(slugify(node.title) || node.id, { title: node.title, body: "" });
      await goto(noteHref(note.id));
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not create the note";
    }
  }

  /** A new canvas with this note in the middle and the notes it links to or is linked from around it. */
  async function toCanvas(id: string): Promise<void> {
    if (!data) return;
    const near = data.edges.filter((e) => e.kind === "link" && !e.dangling && (e.source === id || e.target === id)).map((e) => (e.source === id ? e.target : e.source));
    try {
      const made = await createCanvas(titleOf(id));
      await saveCanvas(made.id, ringBoard(id, near), made.updatedAt);
      await goto(`/canvas/${encodeURIComponent(made.id)}`);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not make a canvas";
    }
  }

  function pick(id: string): void {
    selected = id;
    attentionOpen = false;
  }

  const sections = $derived(
    todo
      ? [
          { key: "due", title: "Recall check is due", rows: todo.due },
          { key: "ghosts", title: "Linked but not written yet", rows: todo.ghosts },
          { key: "orphans", title: "Nothing links to these", rows: todo.orphans },
          { key: "noCards", title: "No study cards yet", rows: todo.noCards },
          { key: "stale", title: "Not touched for 3 months", rows: todo.stale },
        ].filter((s) => s.rows.length > 0)
      : [],
  );
  const attentionCount = $derived(sections.reduce((n, s) => n + s.rows.length, 0));
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Graph · Vigil</title></svelte:head>

<div class="graph">
  <div class="bar">
    <span class="find"><Input type="search" bind:value={query} placeholder="Find a note" aria-label="Find a note" /></span>
    <Cluster gap={1}>
      <Button size="sm" pressed={lens === "tags"} onclick={() => (lens = "tags")}>Tags</Button>
      <Button size="sm" pressed={lens === "memory"} onclick={() => (lens = "memory")}>Memory</Button>
      <Button size="sm" pressed={lens === "agents"} onclick={() => (lens = "agents")}>Agents</Button>
    </Cluster>
    <span class="tag-select">
      <Select aria-label="Show one tag" value={filters.tag ?? ""} onchange={(e) => (filters = { ...filters, tag: e.currentTarget.value === "" ? null : e.currentTarget.value })}>
        <option value="">All tags</option>
        {#each tags as t (t.tag)}<option value={t.tag}>#{t.tag} ({t.count})</option>{/each}
      </Select>
    </span>
    <Button size="sm" pressed={filters.orphansOnly} onclick={() => (filters = { ...filters, orphansOnly: !filters.orphansOnly })}>Orphans</Button>
    <Button size="sm" pressed={filters.hideGhosts} onclick={() => (filters = { ...filters, hideGhosts: !filters.hideGhosts })}>Hide unwritten</Button>
    <Button size="sm" pressed={glow} disabled={lens === "memory"} onclick={() => (glow = !glow)}>Recent glow</Button>
    <Button size="sm" pressed={attentionOpen} onclick={() => ((attentionOpen = !attentionOpen), (selected = null))}>
      Needs attention{#if attentionCount > 0}<Badge>{attentionCount}</Badge>{/if}
    </Button>
    <Button size="sm" pressed={listView} onclick={() => (listView = !listView)} disabled={!webgl}>{listView ? "Show graph" : "List view"}</Button>
    {#if filtered}<Button size="sm" variant="ghost" onclick={() => (filters = { ...NO_FILTERS })}>Clear filters</Button>{/if}
    {#if data?.truncated}<span class="muted">Showing the 3000 most recent notes.</span>{/if}
  </div>

  {#if !webgl}<p class="notice" role="status">Showing a list because your browser can't draw the graph.</p>{/if}

  {#if loading}
    <p class="center muted">Loading…</p>
  {:else if error && !data}
    <p class="center err" role="alert">{error}</p>
  {:else if emptyGraph}
    <p class="center muted">Nothing to draw yet. Create two notes and link them with [[double brackets]].</p>
  {:else if shown && listView}
    <div class="list" aria-label="Notes by connections">
      {#each groups as g (g.label)}
        <h2>{g.label}</h2>
        <div class="rows">
          {#each g.nodes as n (n.id)}
            {#if n.ghost}
              <p class="ghost muted">{n.title} · linked but not written yet <Button size="sm" variant="ghost" onclick={() => void createGhost(n)}>Create</Button></p>
            {:else}
              <Row title={n.title} snippet={`${lens === "memory" && n.memory ? `${memoryLine(n.memory)} · ` : ""}${n.degree} ${n.degree === 1 ? "link" : "links"}${agentsTouching(shown, n.id).length > 0 ? ` · ${agentsTouching(shown, n.id).join(", ")}` : ""}`} onclick={() => pick(n.id)} />
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  {:else if shown}
    <div class="canvaswrap"><GraphCanvas data={shown} {lens} {glow} {query} {selected} onselect={(id) => (id === null ? (selected = null) : pick(id))} onfail={fail} /></div>
    {#if shown.nodes.length === 0}
      <p class="center muted">No notes match these filters.</p>
    {:else if lens === "memory"}
      <p class="legend muted">green = well remembered · red = fading · grey = no card answered yet</p>
    {:else if lens === "agents"}
      <p class="legend muted">amber = read or written by an agent in the last 90 days · lines show which agent</p>
    {:else}
      <p class="legend muted">colour = first tag · bigger = more links · glow = changed in the last 14 days</p>
    {/if}
  {/if}

  {#if selectedNode}
    <aside class="panel" aria-label="Selected">
      <h2>{selectedNode.title}</h2>
      {#if selectedNode.updatedAt}<p class="muted">{formatStamp(selectedNode.updatedAt)}</p>{/if}
      {#if selectedNode.ghost}
        <p class="muted">Linked from {backlinkIds.length} {backlinkIds.length === 1 ? "note" : "notes"}, not written yet.</p>
        <div class="acts"><Button variant="primary" onclick={() => void createGhost(selectedNode)}>Create this note</Button></div>
      {:else}
        {#if selectedNode.memory}<p class="muted">{memoryLine(selectedNode.memory)}</p>{/if}
        <div class="acts">
          <Button variant="primary" onclick={() => openNode(selectedNode.id)}>{selectedNode.kind === "agent" ? "Open agent" : "Open note"}</Button>
          {#if selectedNode.kind === "note" && selectedNode.memory}
            {#if selectedNode.memory.cards > 0}<Button href={`/study?note=${encodeURIComponent(selectedNode.id)}`}>Study this note</Button>{/if}
            <Button href={`/recall?note=${encodeURIComponent(selectedNode.id)}`}>Recall check</Button>
          {/if}
          {#if selectedNode.kind === "note"}<Button onclick={() => void toCanvas(selectedNode.id)}>Put it and its neighbours on a canvas</Button>{/if}
        </div>
      {/if}
      {#if backlinkIds.length > 0}
        <h3>Linked from</h3>
        <ul>{#each backlinkIds as id (id)}<li><a href={noteHref(id)}>{titleOf(id)}</a></li>{/each}</ul>
      {/if}
      {#if touches.length > 0}
        <h3>Agents</h3>
        <ul>
          {#each touches as t, i (i)}
            <li>
              {#if t.runId}<a href={`/runs/${encodeURIComponent(t.runId)}`}>{titleOf(t.source)} {t.kind === "agent-wrote" ? "wrote" : "read"} {titleOf(t.target)}</a>{:else}{titleOf(t.source)} {t.kind === "agent-wrote" ? "wrote" : "read"} {titleOf(t.target)}{/if}
              {#if t.at}<span class="muted"> · {formatStamp(t.at)}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      <div><Button variant="ghost" onclick={() => (selected = null)}>Close</Button></div>
    </aside>
  {:else if attentionOpen}
    <aside class="panel" aria-label="Needs attention">
      <h2>Needs attention</h2>
      {#if sections.length === 0}
        <p class="muted">Nothing stands out. Every note is linked, written and studied.</p>
      {/if}
      {#each sections as s (s.key)}
        <h3>{s.title} <span class="muted">{s.rows.length}</span></h3>
        <div class="rows">
          {#each s.rows.slice(0, 8) as n (n.id)}
            <Row title={n.title} onclick={() => pick(n.id)} />
          {/each}
        </div>
        {#if s.rows.length > 8}<p class="muted">and {s.rows.length - 8} more</p>{/if}
      {/each}
      <div><Button variant="ghost" onclick={() => (attentionOpen = false)}>Close</Button></div>
    </aside>
  {/if}
</div>

<style>
  .graph {
    /* Fill the content area exactly: the canvas needs a real, non-zero height when it starts. */
    position: absolute;
    inset: 0;
    background: var(--paper);
    overflow: hidden;
  }

  .bar {
    position: absolute;
    top: var(--s-3);
    left: var(--s-3);
    right: var(--s-3);
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: center;
  }

  /* The picture sits below the toolbar and above the legend, so nothing is drawn under them. */
  .canvaswrap {
    position: absolute;
    inset: 56px 0 36px 0;
  }

  .find {
    flex: 1 1 8rem;
    max-width: 16rem;
    min-width: 0;
  }

  .tag-select {
    width: 11rem;
  }

  .legend {
    position: absolute;
    left: var(--s-3);
    right: var(--s-3);
    bottom: var(--s-3);
    z-index: 2;
    margin: 0;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-control);
    background: var(--paper);
  }

  .notice {
    position: absolute;
    top: 96px;
    left: var(--s-3);
    z-index: 3;
    margin: 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: var(--s-6);
    text-align: center;
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .err {
    color: var(--danger);
  }

  .list {
    position: absolute;
    inset: 96px 0 0 0;
    overflow-y: auto;
    padding: var(--s-2) var(--s-6) var(--s-6);
  }

  @media (max-width: 639px) {
    .list {
      inset: 168px 0 0 0;
      padding-inline: var(--s-4);
    }
  }

  .list h2 {
    margin: var(--s-4) 0 var(--s-1);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .rows {
    margin: 0 calc(var(--s-3) * -1);
  }

  .ghost {
    margin: 0;
    padding: var(--s-2) var(--s-3);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    width: min(340px, 100%);
    padding: var(--s-4);
    background: var(--paper-float);
    box-shadow: var(--elev-float);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    overflow-y: auto;
  }

  .panel p {
    margin: 0;
  }

  .panel h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  .panel h3 {
    margin: 0;
    color: var(--text-2);
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .acts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
  }
</style>
