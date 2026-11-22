<script lang="ts">
  import { Button, Input, Row } from "$lib/ui";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { createCanvas, getBacklinks, getGraph, saveCanvas, type Backlink } from "$lib/api";
  import { ringBoard } from "$lib/canvas";
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
          labelFont: "system-ui, -apple-system, sans-serif",
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

  /** A new canvas with this note in the middle and the notes it links to or is linked from around it. */
  async function toCanvas(id: string): Promise<void> {
    if (!data) return;
    const near = data.edges.filter((e) => e.kind === "link" && !e.dangling && (e.source === id || e.target === id)).map((e) => (e.source === id ? e.target : e.source));
    try {
      const title = data.nodes.find((n) => n.id === id)?.title ?? id;
      const made = await createCanvas(title);
      await saveCanvas(made.id, ringBoard(id, near), made.updatedAt);
      await goto(`/canvas/${encodeURIComponent(made.id)}`);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not make a canvas";
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
    <span class="find"><Input type="search" bind:value={query} placeholder="Find a note" aria-label="Find a note" /></span>
    <Button size="sm" pressed={memoryView} onclick={() => ((memoryView = !memoryView), renderer?.refresh())}>Memory</Button>
    <Button size="sm" pressed={listView} onclick={() => (listView = !listView)} disabled={!webgl}>{listView ? "Show graph" : "List view"}</Button>
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
        <div class="rows">
          {#each g.nodes.filter((n) => matchesQuery(n.title, query)) as n (n.id)}
            {#if n.ghost}
              <p class="ghost muted">{n.title} · linked but not written yet</p>
            {:else}
              <Row title={n.title} snippet={`${memoryView && n.memory ? `${memoryLine(n.memory)} · ` : ""}${n.degree} ${n.degree === 1 ? "link" : "links"}${data && agentsTouching(data, n.id).length > 0 ? ` · ${agentsTouching(data, n.id).join(", ")}` : ""}`} onclick={() => openNote(n.id)} />
            {/if}
          {/each}
        </div>
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
      {#if selectedNode.updatedAt}<p class="muted">{formatStamp(selectedNode.updatedAt)}</p>{/if}
      {#if selectedNode.ghost}
        <p class="muted">Linked but not written yet.</p>
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
      {#if backlinks.length > 0}
        <h3>Linked from</h3>
        <ul>{#each backlinks as b (b.id)}<li><a href={`/?note=${encodeURIComponent(b.id)}`}>{b.title || b.id}</a></li>{/each}</ul>
      {/if}
      <div><Button variant="ghost" onclick={clearSelection}>Close</Button></div>
    </aside>
  {/if}
</div>

<style>
  .graph {
    /* Fill the content area exactly: the canvas needs a real, non-zero height when it starts. */
    position: absolute;
    inset: 0;
    /* The drawing backdrop is read from the legacy --surface colour (it must be a plain hex for the renderer), so the page matches it. */
    background: var(--surface);
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

  .find {
    flex: 1 1 8rem;
    max-width: 22rem;
    min-width: 0;
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
    left: var(--s-3);
    right: var(--s-3);
    bottom: var(--s-3);
    z-index: 2;
    margin: 0;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-control);
    background: var(--surface);
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
    inset: 56px 0 0 0;
    overflow-y: auto;
    padding: var(--s-2) var(--s-6) var(--s-6);
  }

  @media (max-width: 639px) {
    .list {
      inset: 128px 0 0 0;
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
    width: min(320px, 100%);
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
