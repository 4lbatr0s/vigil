<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { getBacklinks, getGraph, type Backlink } from "$lib/api";
  import {
    agentsTouching,
    buildGraph,
    glowAlpha,
    groupByConnections,
    matchesQuery,
    memoryColor,
    memoryLine,
    neighborSet,
    withAlpha,
    type GraphApi,
    type GraphColors,
    type NoteMemoryData,
  } from "$lib/graph-model";
  import { formatStamp } from "$lib/format";

  type Renderer = { kill(): void; refresh(): void; resize(): void; getCamera(): { animatedReset(o?: { duration: number }): void; setState(s: { x: number; y: number; ratio: number; angle: number }): void }; graphToViewport(c: { x: number; y: number }): { x: number; y: number }; scaleSize(size?: number): number; setGraphState(s: Record<string, unknown>): unknown; on(e: string, f: (p: any) => void): unknown };

  let data = $state<GraphApi | null>(null);
  let error = $state("");
  let loading = $state(true);
  let listView = $state(false);
  /** Memory view: notes colored by how much of them you remember (ADR-0022), instead of plain dots. */
  let memoryView = $state(false);
  let memoryColors = { fading: "", strong: "", plain: "" };
  let webgl = $state(true);
  let query = $state("");
  let selected = $state<string | null>(null);
  let backlinks = $state<Backlink[]>([]);
  let host = $state<HTMLDivElement | null>(null);
  let overlay = $state<HTMLCanvasElement | null>(null);

  let renderer: Renderer | null = null;
  let layoutStop: (() => void) | null = null;
  let graphRef: import("graphology").default | null = null;
  let colors: GraphColors | null = null;
  let amber = "";
  let ink = "";
  let reducedMotion = false;

  const selectedNode = $derived(data?.nodes.find((n) => n.id === selected) ?? null);
  const groups = $derived(data ? groupByConnections(data) : []);
  const emptyGraph = $derived(data !== null && data.nodes.filter((n) => n.kind === "note").length < 2);

  function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hasWebgl(): boolean {
    try {
      const c = document.createElement("canvas");
      return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  onMount(() => {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    webgl = hasWebgl();
    listView = !webgl;
    void (async () => {
      try {
        data = await getGraph();
      } catch (err) {
        error = err instanceof Error ? err.message : "Could not load the graph";
      } finally {
        loading = false;
      }
    })();
    return teardown;
  });

  function teardown(): void {
    layoutStop?.();
    renderer?.kill();
    renderer = null;
  }

  // Draw (or redraw) the graph when the data arrives and the canvas view is showing.
  $effect(() => {
    if (!data || !host || listView || !webgl || emptyGraph) return;
    void draw(data, host);
    return teardown;
  });

  async function draw(api: GraphApi, container: HTMLDivElement): Promise<void> {
    // The heavy libraries load only when this page draws (code splitting, WP4-T10).
    const [sigmaModule, fa2, { default: FA2Layout }] = await Promise.all([
      import("sigma"),
      import("graphology-layout-forceatlas2"),
      import("graphology-layout-forceatlas2/worker"),
    ]);
    const Sigma = sigmaModule.default;
    const { DEFAULT_STYLES } = sigmaModule;
    // The container's styles can arrive a frame after the script (dev server, slow disk): wait until it has a size.
    for (let i = 0; i < 30 && (container.clientHeight === 0 || container.clientWidth === 0); i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!container.isConnected) return; // the page was left while waiting
    teardown();
    amber = token("--amber");
    ink = token("--ink");
    colors = {
      note: token("--ink-muted"),
      agent: token("--surface"), // drawn hollow: the overlay strokes the ring in --ink
      ghost: token("--hairline"),
      link: token("--hairline"),
      agentEdge: withAlpha(amber, 0.4),
    };
    memoryColors = { fading: token("--err"), strong: token("--ok"), plain: token("--ink-muted") };
    const graph = buildGraph(api, colors);
    graphRef = graph;
    paintNodes();

    const settings = fa2.default.inferSettings(graph);
    if (graph.order <= 500) {
      fa2.default.assign(graph, { iterations: 200, settings });
    }

    const instance = new Sigma(graph, container, {
      settings: {
        renderLabels: true,
        labelDensity: 0.6,
        labelRenderedSizeThreshold: 6,
        zoomDuration: reducedMotion ? 0 : 250,
        doubleClickZoomingDuration: reducedMotion ? 0 : 250,
        enableEdgeEvents: false,
        // Sizes are pixels of radius and do not grow when zooming (the overlay draws in pixels too).
        zoomToSizeRatioFunction: () => 1,
        autoRescale: true,
      },
      // Label and hover-backdrop colors come from the tokens too (sigma's defaults are black text on white).
      styles: {
        edges: { ...DEFAULT_STYLES.edges },
        nodes: {
          ...DEFAULT_STYLES.nodes,
          size: { attribute: "size", defaultValue: 3 },
          labelColor: token("--ink-muted"),
          labelSize: 12,
          labelFont: "Schibsted Grotesk Variable, system-ui, sans-serif",
          backdropColor: token("--surface"),
          backdropShadowColor: "transparent",
          backdropShadowBlur: 0,
        },
      },
      customGraphState: { hovered: null as string | null, selected: null as string | null, query: "" },
      nodeReducer: (key, computed, _attrs, _state, gs, g) => {
        const focus = (gs as { hovered: string | null; selected: string | null; query: string }).hovered ?? (gs as { selected: string | null }).selected;
        const q = (gs as { query: string }).query;
        let dim = false;
        if (focus && !neighborSet(g, focus).has(key)) dim = true;
        if (q && !matchesQuery(String(g.getNodeAttribute(key, "label")), q)) dim = true;
        return dim ? { ...computed, label: "", color: colors?.link ?? computed.color } : computed;
      },
      edgeReducer: (_key, computed, attrs, _state, gs, g) => {
        // Agent edges are drawn dashed on the overlay, so the WebGL layer never draws them.
        if ((attrs as { agent?: boolean }).agent) return { ...computed, hidden: true };
        const focus = (gs as { hovered: string | null }).hovered;
        if (!focus) return computed;
        const ext = g.extremities(_key);
        return ext[0] === focus || ext[1] === focus ? computed : { ...computed, hidden: true };
      },
    }) as unknown as Renderer;
    renderer = instance;

    instance.on("enterNode", ({ node }: { node: string }) => instance.setGraphState({ hovered: node }));
    instance.on("leaveNode", () => instance.setGraphState({ hovered: null }));
    instance.on("clickNode", ({ node }: { node: string }) => void select(node));
    instance.on("clickStage", () => clearSelection());
    instance.on("afterRender", paintOverlay);
    paintOverlay(); // the first render happened before the listener existed

    if (graph.order > 500) {
      // Big graphs lay out in a web worker so the page stays responsive; stop after a few seconds.
      const layout = new FA2Layout(graph, { settings });
      layout.start();
      const timer = setTimeout(() => layout.stop(), 4000);
      layoutStop = () => {
        clearTimeout(timer);
        layout.kill();
      };
    }
  }

  /** Recolors the note dots for the current view; the renderer picks the change up on the next frame. */
  function paintNodes(): void {
    const graph = graphRef;
    if (!graph) return;
    graph.forEachNode((id, attrs) => {
      if (attrs["kind"] !== "note" || attrs["ghost"] === true) return;
      const memory = (attrs["memory"] as NoteMemoryData | null) ?? undefined;
      graph.setNodeAttribute(id, "color", memoryView ? memoryColor(memory, memoryColors) : (colors?.note ?? memoryColors.plain));
    });
    renderer?.refresh();
  }

  $effect(() => {
    void memoryView;
    paintNodes();
  });

  /** The 2D layer: amber halos under recent notes and dashed amber lines for agent edges (ADR-0012). */
  function paintOverlay(): void {
    const canvas = overlay;
    const graph = graphRef;
    const r = renderer;
    if (!canvas || !graph || !r || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = new Date();
    graph.forEachNode((id, attrs) => {
      if (attrs["kind"] !== "note") return;
      const alpha = memoryView ? 0 : glowAlpha((attrs["updatedAt"] as string | null) ?? undefined, now);
      if (alpha <= 0) return;
      const p = r.graphToViewport({ x: attrs["x"] as number, y: attrs["y"] as number });
      const size = r.scaleSize(attrs["size"] as number);
      const outer = size * 3.2;
      const grad = ctx.createRadialGradient(p.x, p.y, size * 0.8, p.x, p.y, outer);
      grad.addColorStop(0, withAlpha(amber, 0.55 * alpha));
      grad.addColorStop(1, withAlpha(amber, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, outer, 0, Math.PI * 2);
      ctx.fill();
      void id;
    });

    // Memory view: a thin ring around a note whose recall check is due.
    if (memoryView) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ink;
      graph.forEachNode((_id, attrs) => {
        if (attrs["kind"] !== "note" || !(attrs["memory"] as NoteMemoryData | null)?.recallDue) return;
        const p = r.graphToViewport({ x: attrs["x"] as number, y: attrs["y"] as number });
        ctx.beginPath();
        ctx.arc(p.x, p.y, r.scaleSize(attrs["size"] as number) + 3, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    // Agents are rings: the node itself is hollow, the ring is stroked here.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    graph.forEachNode((_id, attrs) => {
      if (attrs["kind"] !== "agent") return;
      const p = r.graphToViewport({ x: attrs["x"] as number, y: attrs["y"] as number });
      ctx.beginPath();
      ctx.arc(p.x, p.y, r.scaleSize(attrs["size"] as number), 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(amber, 0.4);
    graph.forEachEdge((_e, attrs, s, t) => {
      if (!attrs["agent"]) return;
      const a = r.graphToViewport({ x: graph.getNodeAttribute(s, "x") as number, y: graph.getNodeAttribute(s, "y") as number });
      const b = r.graphToViewport({ x: graph.getNodeAttribute(t, "x") as number, y: graph.getNodeAttribute(t, "y") as number });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  async function select(id: string): Promise<void> {
    selected = id;
    renderer?.setGraphState({ selected: id });
    backlinks = [];
    if (!id.startsWith("agent:") && !data?.nodes.find((n) => n.id === id)?.ghost) {
      try {
        backlinks = await getBacklinks(id);
      } catch {
        backlinks = [];
      }
    }
  }

  function clearSelection(): void {
    selected = null;
    backlinks = [];
    renderer?.setGraphState({ selected: null });
  }

  $effect(() => {
    renderer?.setGraphState({ query });
  });

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (selected) clearSelection();
      else if (query) query = "";
    }
  }

  function openNote(id: string): void {
    void goto(`/?note=${encodeURIComponent(id)}`);
  }

  function openNode(id: string): void {
    if (id.startsWith("agent:")) void goto(`/agents/${encodeURIComponent(id.slice(6))}`);
    else openNote(id);
  }
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Graph · Vigil</title></svelte:head>

<div class="graph">
  <div class="bar">
    <input type="search" bind:value={query} placeholder="Find a note" aria-label="Find a note" />
    <button type="button" class="act" aria-pressed={memoryView} onclick={() => ((memoryView = !memoryView), renderer?.refresh())} title="Color notes by how much of them you remember">Memory</button>
    <button type="button" class="act" aria-pressed={listView} onclick={() => (listView = !listView)} disabled={!webgl}>{listView ? "Show graph" : "List view"}</button>
    {#if data?.truncated}<span class="muted">Showing the 3000 most recent notes.</span>{/if}
  </div>

  {#if !webgl}<p class="notice" role="status">Showing a list because your browser can't draw the graph.</p>{/if}

  {#if loading}
    <p class="center muted">Loading…</p>
  {:else if error}
    <p class="center err" role="alert">{error}</p>
  {:else if emptyGraph}
    <p class="center muted">Nothing to draw yet. Create two notes and link them with [[double brackets]].</p>
  {:else if listView}
    <div class="list" aria-label="Notes by connections">
      {#each groups as g (g.label)}
        <h2>{g.label}</h2>
        <ul>
          {#each g.nodes.filter((n) => matchesQuery(n.title, query)) as n (n.id)}
            <li>
              <button type="button" class="item" onclick={() => (n.ghost ? undefined : openNote(n.id))} disabled={n.ghost}>
                <span class="title">{n.title}</span>
                <span class="meta">{#if memoryView && n.memory}{memoryLine(n.memory)} · {/if}{n.degree} {n.degree === 1 ? "link" : "links"}{#if data && agentsTouching(data, n.id).length > 0} · {agentsTouching(data, n.id).join(", ")}{/if}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  {:else}
    <div class="canvas" bind:this={host} role="application" aria-label="Graph of notes and agents. Use the list view for keyboard access."></div>
    <canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>
    {#if memoryView}
      <p class="legend muted">green = well remembered · red = fading · grey = no card answered yet · ring = recall check due</p>
    {:else}
      <p class="legend muted">dot = note · ring = agent · dashed line = agent read or wrote · glow = changed in the last 14 days</p>
    {/if}
  {/if}

  {#if selectedNode}
    <aside class="panel" aria-label="Selected">
      <h2>{selectedNode.title}</h2>
      {#if selectedNode.updatedAt}<p class="mono muted">{formatStamp(selectedNode.updatedAt)}</p>{/if}
      {#if selectedNode.ghost}
        <p class="muted">Linked but not written yet.</p>
      {:else}
        {#if selectedNode.memory}<p class="muted">{memoryLine(selectedNode.memory)}</p>{/if}
        <button type="button" class="act primary" onclick={() => openNode(selectedNode.id)}>{selectedNode.kind === "agent" ? "Open agent" : "Open note"}</button>
        {#if selectedNode.kind === "note" && selectedNode.memory}
          {#if selectedNode.memory.cards > 0}<a class="act" href={`/study?note=${encodeURIComponent(selectedNode.id)}`}>Study this note</a>{/if}
          <a class="act" href={`/recall?note=${encodeURIComponent(selectedNode.id)}`}>Recall check</a>
        {/if}
      {/if}
      {#if backlinks.length > 0}
        <h3>Linked from</h3>
        <ul>{#each backlinks as b (b.id)}<li><a href={`/?note=${encodeURIComponent(b.id)}`}>{b.title || b.id}</a></li>{/each}</ul>
      {/if}
      <button type="button" class="act" onclick={clearSelection}>Close</button>
    </aside>
  {/if}
</div>

<style>
  .graph {
    /* Fill the content area exactly: the canvas needs a real, non-zero height when it starts. */
    position: absolute;
    inset: 0;
    background: var(--bg);
    overflow: hidden;
  }
  .bar {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 3;
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  input {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-ui);
  }
  .canvas,
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .overlay {
    pointer-events: none;
    z-index: 1;
  }
  .legend {
    position: absolute;
    left: var(--space-3);
    bottom: var(--space-3);
    z-index: 2;
    font-size: var(--text-label);
  }
  .notice {
    position: absolute;
    top: 52px;
    left: var(--space-3);
    z-index: 3;
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-6);
    text-align: center;
  }
  .muted {
    color: var(--ink-muted);
  }
  .err {
    color: var(--err-ink);
  }
  .list {
    position: absolute;
    inset: 56px 0 0 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-6) var(--space-6);
  }
  .list h2 {
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink-muted);
    margin: var(--space-4) 0 var(--space-1);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-2);
    border-bottom: 1px solid var(--hairline);
    text-align: left;
  }
  .item:hover:not(:disabled) {
    background: var(--surface);
  }
  .item:disabled {
    color: var(--ink-muted);
    cursor: default;
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
  }
  .meta,
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    width: min(320px, 100%);
    padding: var(--space-4);
    background: var(--surface);
    border-left: 1px solid var(--hairline);
    display: grid;
    align-content: start;
    gap: var(--space-3);
    overflow-y: auto;
  }
  .panel h2 {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    font-weight: 600;
  }
  .panel h3 {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .act {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
    justify-self: start;
  }
  .act.primary {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }
  .act:disabled {
    opacity: 0.5;
  }
</style>
