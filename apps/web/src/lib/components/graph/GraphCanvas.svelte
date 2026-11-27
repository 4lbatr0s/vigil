<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type Graph from "graphology";
  import {
    buildGraph,
    glowAlpha,
    matchesQuery,
    memoryColor,
    neighborSet,
    primaryTag,
    radialLayout,
    tagSlot,
    withAlpha,
    type GraphApi,
    type GraphColors,
    type NoteMemoryData,
  } from "$lib/graph-model";
  import { readGraphTheme, watchTheme, type GraphTheme } from "$lib/graph-theme";

  /**
   * One graph picture, used by the Map page and by the Connections panel on a note.
   * The renderer is made once; a change of data, lens, filter, search or theme updates it in place, so the
   * camera and the layout do not jump. `mode="local"` is the small picture around one note: the note in the
   * middle, each hop on a ring, every label shown.
   */
  type Lens = "tags" | "memory" | "agents";
  type Props = {
    data: GraphApi;
    mode?: "map" | "local";
    /** For `local`: the note in the middle. */
    focusId?: string | null;
    lens?: Lens;
    /** An amber glow under notes changed in the last 14 days. */
    glow?: boolean;
    /** Notes whose title does not match are dimmed. */
    query?: string;
    selected?: string | null;
    onselect?: (id: string | null) => void;
    /** Called if the browser cannot draw the graph. */
    onfail?: () => void;
  };
  let { data, mode = "map", focusId = null, lens = "tags", glow = true, query = "", selected = null, onselect, onfail }: Props = $props();

  type State = { focus: Set<string> | null; hovered: string | null; query: string };
  type NodeBits = { label?: string; color?: string; hidden?: boolean; zIndex?: number };
  /** The few parts of Sigma this component uses. */
  interface GraphRenderer {
    kill(): void;
    refresh(): void;
    resize(): void;
    setGraph(graph: Graph): void;
    getCamera(): { reset(o?: { duration: number }): Promise<void> };
    graphToViewport(c: { x: number; y: number }): { x: number; y: number };
    scaleSize(size?: number): number;
    setGraphState(s: Partial<State>): void;
    on(event: "enterNode" | "leaveNode" | "clickNode", handler: (p: { node: string }) => void): unknown;
    on(event: "clickStage" | "afterRender", handler: () => void): unknown;
  }

  let host = $state<HTMLDivElement | null>(null);
  let overlay = $state<HTMLCanvasElement | null>(null);
  let renderer: GraphRenderer | null = null;
  let graph: Graph | null = null;
  let theme: GraphTheme | null = null;
  let ready = $state(false);
  let destroyed = false;
  let themeVersion = $state(0);
  /** Where each note was last drawn, so a refresh keeps the picture steady. */
  const placed = new Map<string, { x: number; y: number }>();
  let lastFocus: string | null | undefined;
  let lastMode: string | undefined;
  let building = 0;

  const LOCAL_SCALE = 14;

  const colorsFor = (t: GraphTheme): GraphColors => ({ note: t.note, agent: t.agent, ghost: t.line, link: t.line, agentEdge: t.agent });

  onMount(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void start(reduced);
    const stopTheme = watchTheme(() => (themeVersion += 1));
    const resizer = new ResizeObserver(() => {
      // A hidden box (another tab, a closed panel) has no size; Sigma refuses to draw into it, so wait.
      if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
      renderer?.resize();
      renderer?.refresh();
      paintOverlay();
    });
    if (host) resizer.observe(host);
    return () => {
      destroyed = true;
      building += 1;
      stopTheme();
      resizer.disconnect();
      renderer?.kill();
      renderer = null;
      graph = null;
    };
  });

  /** Creates the renderer once: loads the drawing libraries, waits until the box has a size, then draws the first data. */
  async function start(reduced: boolean): Promise<void> {
    const mine = ++building;
    const [sigmaModule, graphologyModule] = await Promise.all([import("sigma"), import("graphology")]);
    const container = host;
    if (!container) return;
    // The box can get its size a frame after the script (dev server, slow disk): wait for it.
    for (let i = 0; i < 30 && (container.clientHeight === 0 || container.clientWidth === 0); i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
    if (destroyed || mine !== building || !container.isConnected) return;
    theme = readGraphTheme();
    const first = buildGraph(untrack(() => data), colorsFor(theme));
    const Sigma = sigmaModule.default;
    const { DEFAULT_STYLES } = sigmaModule;
    const local = untrack(() => mode) === "local";
    try {
      renderer = new Sigma(first, container, {
        settings: {
          renderLabels: true,
          labelDensity: local ? 2 : 0.6,
          labelRenderedSizeThreshold: local ? 0 : 6,
          zoomDuration: reduced ? 0 : 250,
          doubleClickZoomingDuration: reduced ? 0 : 250,
          enableEdgeEvents: false,
          // Sizes are pixels of radius and do not grow when zooming (the overlay draws in pixels too).
          zoomToSizeRatioFunction: () => 1,
          autoRescale: true,
          allowInvalidContainer: true,
          // Room for long labels at the edge of the box.
          stagePadding: local ? 80 : 40,
        },
        styles: {
          edges: { ...DEFAULT_STYLES.edges },
          nodes: {
            ...DEFAULT_STYLES.nodes,
            size: { attribute: "size", defaultValue: 3 },
            labelColor: theme.note,
            labelSize: 12,
            labelFont: "system-ui, -apple-system, sans-serif",
            backdropColor: theme.paper,
            backdropShadowColor: "transparent",
            backdropShadowBlur: 0,
          },
        },
        customGraphState: { focus: null, hovered: null, query: "" } satisfies State,
        nodeReducer: (key, computed, _attrs, _state, gs) => {
          const s = gs as State;
          let dim = s.focus !== null && !s.focus.has(key);
          if (s.query && !matchesQuery(String(graph?.getNodeAttribute(key, "label") ?? ""), s.query)) dim = true;
          return dim ? ({ ...computed, label: "", color: theme?.line ?? computed.color } satisfies NodeBits) : computed;
        },
        edgeReducer: (key, computed, _attrs, _state, gs) => {
          const s = gs as State;
          if (!s.hovered || !graph) return computed;
          const [a, b] = graph.extremities(key);
          return a === s.hovered || b === s.hovered ? computed : { ...computed, hidden: true };
        },
      }) as unknown as GraphRenderer;
    } catch {
      onfail?.();
      return;
    }
    graph = first;
    renderer.on("enterNode", ({ node }) => hover(node));
    renderer.on("leaveNode", () => hover(null));
    renderer.on("clickNode", ({ node }) => onselect?.(node));
    renderer.on("clickStage", () => onselect?.(null));
    renderer.on("afterRender", paintOverlay);
    ready = true;
  }

  // New data, a new focus or a new mode: rebuild the graph and swap it in, keeping where notes already were.
  $effect(() => {
    const d = data;
    const f = focusId;
    const m = mode;
    if (!ready || !renderer) return;
    untrack(() => void apply(d, f, m));
  });

  async function apply(d: GraphApi, f: string | null, m: "map" | "local"): Promise<void> {
    const mine = ++building;
    const t = theme ?? readGraphTheme();
    theme = t;
    const next = buildGraph(d, colorsFor(t));
    const fresh = lastFocus !== f || lastMode !== m || placed.size === 0;
    if (m === "local" && f) {
      const spots = radialLayout(d, f);
      next.forEachNode((id) => {
        const p = spots.get(id);
        // Sigma draws node sizes in the same units as positions, so the rings are spread wide enough for small dots.
        if (p) next.mergeNodeAttributes(id, { x: p.x * LOCAL_SCALE, y: p.y * LOCAL_SCALE });
        next.setNodeAttribute(id, "size", id === f ? 2.8 : id.startsWith("agent:") ? 2 : 1.8);
      });
    } else {
      let kept = 0;
      next.forEachNode((id) => {
        const p = placed.get(id);
        if (p) {
          next.mergeNodeAttributes(id, p);
          kept += 1;
        }
      });
      // Notes that are new sit among the notes they link to; the rest of the picture stays where it was.
      const needsLayout = kept < next.order;
      if (needsLayout) {
        const fa2 = await import("graphology-layout-forceatlas2");
        if (destroyed || mine !== building) return;
        const settings = { ...fa2.default.inferSettings(next), barnesHutOptimize: next.order > 1500 };
        const iterations = next.order > 1500 ? 60 : kept === 0 ? 200 : 40;
        fa2.default.assign(next, { iterations, settings });
      }
    }
    next.forEachNode((id, attrs) => placed.set(id, { x: attrs["x"] as number, y: attrs["y"] as number }));
    for (const id of [...placed.keys()]) if (!next.hasNode(id)) placed.delete(id);
    graph = next;
    recolor();
    renderer?.setGraph(next);
    if (fresh) void renderer?.getCamera().reset({ duration: 0 });
    lastFocus = f;
    lastMode = m;
    syncState();
    renderer?.refresh();
  }

  /** Colours and visibility for the current lens, theme and mode. */
  function recolor(): void {
    const g = graph;
    const t = theme;
    if (!g || !t) return;
    const showAgents = mode === "local" || lens === "agents";
    const touched = new Set<string>();
    g.forEachEdge((_e, a, _s, target) => {
      if (a["agent"]) touched.add(target);
    });
    const memoryColors = { fading: t.danger, strong: t.good, plain: t.note };
    g.forEachNode((id, a) => {
      if (a["kind"] === "agent") {
        g.setNodeAttribute(id, "color", t.agent);
        g.setNodeAttribute(id, "hidden", !showAgents);
        return;
      }
      g.setNodeAttribute(id, "hidden", false);
      if (a["ghost"] === true) return void g.setNodeAttribute(id, "color", t.line);
      let color = t.note;
      if (id === focusId && mode === "local") color = t.text;
      else if (lens === "memory" && mode === "map") color = memoryColor((a["memory"] as NoteMemoryData | null) ?? undefined, memoryColors);
      else if (lens === "agents" && mode === "map") color = touched.has(id) ? t.agent : t.line;
      else if (lens === "tags" && mode === "map") {
        const tag = primaryTag((data.nodes.find((n) => n.id === id)?.tags) ?? undefined);
        color = tag === null ? t.note : (t.palette[tagSlot(tag)] ?? t.note);
      }
      g.setNodeAttribute(id, "color", color);
    });
    g.forEachEdge((e, a) => {
      const agent = a["agent"] === true;
      g.setEdgeAttribute(e, "hidden", agent && !showAgents);
      g.setEdgeAttribute(e, "color", agent ? withAlpha(t.agent, 0.55) : t.line);
    });
  }

  // A new lens or a new theme only recolours.
  $effect(() => {
    void lens;
    void themeVersion;
    void mode;
    if (!ready) return;
    untrack(() => {
      if (themeVersion > 0) theme = readGraphTheme();
      recolor();
      renderer?.refresh();
      paintOverlay();
    });
  });

  // Search and selection only dim.
  $effect(() => {
    void query;
    void selected;
    if (ready) untrack(syncState);
  });

  let hovered: string | null = null;
  function hover(id: string | null): void {
    hovered = id;
    syncState();
  }

  /** The set of notes shown at full strength, worked out once per change and not once per node per frame. */
  function syncState(): void {
    const g = graph;
    const focus = hovered ?? selected;
    renderer?.setGraphState({ focus: focus && g ? neighborSet(g, focus) : null, hovered: focus, query });
    paintOverlay();
  }

  /** The 2D layer: an amber halo under recently changed notes. */
  function paintOverlay(): void {
    const canvas = overlay;
    const g = graph;
    const r = renderer;
    const t = theme;
    if (!canvas || !g || !r || !host || !t) return;
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
    if (!glow || lens === "memory" || mode === "local") return;
    const now = new Date();
    g.forEachNode((_id, a) => {
      if (a["kind"] !== "note" || a["hidden"] === true) return;
      const alpha = glowAlpha((a["updatedAt"] as string | null) ?? undefined, now);
      if (alpha <= 0) return;
      const p = r.graphToViewport({ x: a["x"] as number, y: a["y"] as number });
      const size = r.scaleSize(a["size"] as number);
      const outer = size * 3.2;
      const gradient = ctx.createRadialGradient(p.x, p.y, size * 0.8, p.x, p.y, outer);
      gradient.addColorStop(0, withAlpha(t.agent, 0.55 * alpha));
      gradient.addColorStop(1, withAlpha(t.agent, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, outer, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  $effect(() => {
    void glow;
    if (ready) untrack(paintOverlay);
  });
</script>

<div class="stage" bind:this={host} role="application" aria-label="Graph of notes. The list view has the same notes for keyboard use."></div>
<canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>

<style>
  .stage,
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
</style>
