<script lang="ts">
  import { setContext, untrack } from "svelte";
  import { Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, MiniMap, Panel, SvelteFlow, useSvelteFlow, type Edge, type Node } from "@xyflow/svelte";
  import { getNote, listNotes, uploadImage } from "$lib/api";
  import { History, PRESETS, PRESET_NAMES, SIZES, cssColor, excerpt, imageNameOf, newId, noteFile, noteIdOf, snapshot, toBoard, toFile, type BoardEdge, type BoardNode, type CanvasFile, type CardData, type CardKind } from "$lib/canvas";
  import type { NoteSummary } from "@vigil/shared";
  import { CANVAS_KEY, type CanvasContext } from "./context";
  import GroupBox from "./GroupBox.svelte";
  import LinkCard from "./LinkCard.svelte";
  import NoteCard from "./NoteCard.svelte";
  import TextCard from "./TextCard.svelte";

  let { initial, onChange }: { initial: CanvasFile; onChange: (file: CanvasFile) => void } = $props();

  const nodeTypes = { text: TextCard, file: NoteCard, link: LinkCard, group: GroupBox };
  const flow = useSvelteFlow();

  // The board is made once from the file it opens with; a reload makes a new board.
  const start = untrack(() => toBoard(initial));
  let nodes = $state.raw<Node[]>(start.nodes as unknown as Node[]);
  let edges = $state.raw<Edge[]>(start.edges.map(decorate));
  const history = new History(untrack(() => snapshot(start.nodes, start.edges)));
  let canUndo = $state(false);
  let canRedo = $state(false);
  let selectedNodes = $state<string[]>([]);
  let selectedEdges = $state<string[]>([]);
  let outline = $state(false);
  let picking = $state(false);
  let pickQuery = $state("");
  let notes = $state<NoteSummary[]>([]);

  /** Arrowheads and color are display; the file keeps only what the format has. */
  function decorate(e: BoardEdge | (Edge & Partial<BoardEdge>)): Edge {
    const data = (e as BoardEdge).data;
    const color = cssColor(data?.color);
    return {
      ...(e as Edge),
      type: "default",
      ...(color ? { style: `stroke: ${color}` } : {}),
      ...(data?.toEnd !== "none" ? { markerEnd: { type: MarkerType.ArrowClosed, ...(color ? { color } : {}) } } : {}),
      ...(data?.fromEnd === "arrow" ? { markerStart: { type: MarkerType.ArrowClosed, ...(color ? { color } : {}) } } : {}),
    };
  }

  const asBoard = (): { nodes: BoardNode[]; edges: BoardEdge[] } => ({ nodes: nodes.map((n) => ({ id: n.id, type: n.type as CardKind, position: n.position, width: n.width ?? n.measured?.width ?? 200, height: n.height ?? n.measured?.height ?? 100, zIndex: n.zIndex ?? 0, data: n.data as CardData })), edges: edges as unknown as BoardEdge[] });

  /** A change is finished: save it and make it one undo step. */
  function commit(): void {
    const b = asBoard();
    history.push(snapshot(b.nodes, b.edges));
    canUndo = history.canUndo;
    canRedo = history.canRedo;
    onChange(toFile(b.nodes, b.edges));
  }

  function load(text: string): void {
    const file = JSON.parse(text) as CanvasFile;
    const b = toBoard(file);
    nodes = b.nodes as unknown as Node[];
    edges = b.edges.map(decorate);
    canUndo = history.canUndo;
    canRedo = history.canRedo;
    onChange(file);
  }

  function undo(): void {
    const t = history.undo();
    if (t !== null) load(t);
  }
  function redo(): void {
    const t = history.redo();
    if (t !== null) load(t);
  }

  function onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
  }

  // ---- notes shown on cards ----
  const info = $state<Record<string, { title: string; excerpt: string; missing: boolean } | null>>({});
  const noteInfo = (noteId: string): { title: string; excerpt: string; missing: boolean } | null => info[noteId] ?? null;
  function loadNote(noteId: string): void {
    if (noteId in info) return;
    info[noteId] = null;
    void getNote(noteId)
      .then((n) => (info[noteId] = { title: n.title, excerpt: excerpt(n.body), missing: false }))
      .catch(() => (info[noteId] = { title: noteId, excerpt: "", missing: true }));
  }

  setContext<CanvasContext>(CANVAS_KEY, {
    update(id, patch) {
      nodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as CardData), ...patch } } : n));
    },
    commit,
    noteInfo,
    loadNote,
  });

  // ---- adding things ----
  const taken = (): Set<string> => new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);

  /** The middle of what is on screen, in board coordinates, so a new card appears where you are looking. */
  function center(size: { width: number; height: number }): { x: number; y: number } {
    const el = document.querySelector(".canvas-wrap");
    const r = el?.getBoundingClientRect();
    const p = flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 });
    // A little stagger so cards added in a row do not hide each other.
    const bump = (nodes.length % 6) * 24;
    return { x: Math.round(p.x - size.width / 2 + bump), y: Math.round(p.y - size.height / 2 + bump) };
  }

  function add(kind: CardKind, data: Partial<CardData> = {}, at?: { x: number; y: number }): void {
    const size = SIZES[kind];
    const id = newId(kind[0] ?? "n", taken());
    const top = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0) + 1;
    const node: BoardNode = { id, type: kind, position: at ?? center(size), width: size.width, height: size.height, zIndex: kind === "group" ? 0 : top, data: { kind, extra: {}, ...data } };
    nodes = [...nodes.map((n) => ({ ...n, selected: false })), { ...(node as unknown as Node), selected: true }];
    commit();
  }

  function addNote(n: NoteSummary): void {
    add("file", { file: noteFile(n.id) });
    picking = false;
    pickQuery = "";
  }

  async function openPicker(): Promise<void> {
    picking = !picking;
    if (picking && notes.length === 0) notes = await listNotes().catch(() => []);
  }

  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  let imageError = $state("");

  /** A picture from your computer becomes a card; it is stored in the vault like a pasted picture (png, jpg, gif, webp). */
  async function addImage(file: File | undefined): Promise<void> {
    if (!file) return;
    imageError = "";
    try {
      const up = await uploadImage(file);
      add("file", { file: `attachments/${up.name}` });
    } catch (err) {
      imageError = err instanceof Error ? err.message.replace(/^[a-z-]+: /, "") : "Could not add the picture";
    }
  }

  const pickable = $derived(notes.filter((n) => pickQuery.trim() === "" || n.title.toLowerCase().includes(pickQuery.trim().toLowerCase())).slice(0, 40));

  function onPaneDoubleClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest(".svelte-flow__node, .svelte-flow__edge, .svelte-flow__panel, .svelte-flow__controls, .svelte-flow__minimap")) return;
    add("text", {}, (() => { const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); return { x: Math.round(p.x - SIZES.text.width / 2), y: Math.round(p.y - 20) }; })());
  }

  // ---- connections: the arrow the person draws becomes a full edge of the format ----
  function onBeforeConnect(c: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null }): Edge | false {
    if (c.source === c.target) return false;
    const id = newId("e", taken());
    return { id, source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? "right", targetHandle: c.targetHandle ?? "left", data: { fromEnd: "none", toEnd: "arrow", extra: {} }, markerEnd: { type: MarkerType.ArrowClosed } };
  }

  /**
   * Dropping an arrow anywhere on a card connects it to the nearest side, as in Obsidian; Svelte Flow alone only
   * connects when the drop lands on a connection point.
   */
  function onConnectEnd(event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromNode: { id: string } | null; fromHandle: { id?: string | null } | null }): void {
    if (state.isValid === true || !state.fromNode) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    const el = document.elementFromPoint(point.clientX, point.clientY)?.closest(".svelte-flow__node") as HTMLElement | null;
    const targetId = el?.dataset.id;
    if (!el || !targetId || targetId === state.fromNode.id) return;
    const r = el.getBoundingClientRect();
    const dist: [string, number][] = [
      ["top", Math.abs(point.clientY - r.top)],
      ["bottom", Math.abs(point.clientY - r.bottom)],
      ["left", Math.abs(point.clientX - r.left)],
      ["right", Math.abs(point.clientX - r.right)],
    ];
    const side = dist.sort((a, b) => a[1] - b[1])[0]?.[0] ?? "left";
    const edge = onBeforeConnect({ source: state.fromNode.id, target: targetId, sourceHandle: state.fromHandle?.id ?? "right", targetHandle: side });
    if (edge === false) return;
    edges = [...edges, edge];
    commit();
  }

  // ---- moving a group moves the cards inside it, as in Obsidian ----
  let groupDrag: { id: string; at: { x: number; y: number }; kids: Map<string, { x: number; y: number }> } | null = null;

  function inside(g: Node, n: Node): boolean {
    const gw = g.width ?? g.measured?.width ?? 0;
    const gh = g.height ?? g.measured?.height ?? 0;
    const cx = n.position.x + (n.width ?? n.measured?.width ?? 0) / 2;
    const cy = n.position.y + (n.height ?? n.measured?.height ?? 0) / 2;
    return cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh;
  }

  function dragStart({ targetNode }: { targetNode: Node | null }): void {
    groupDrag = null;
    if (!targetNode || targetNode.type !== "group") return;
    const kids = new Map<string, { x: number; y: number }>();
    for (const n of nodes) if (n.id !== targetNode.id && n.type !== "group" && inside(targetNode, n)) kids.set(n.id, { ...n.position });
    groupDrag = { id: targetNode.id, at: { ...targetNode.position }, kids };
  }

  function drag({ targetNode }: { targetNode: Node | null }): void {
    if (!groupDrag || !targetNode || targetNode.id !== groupDrag.id) return;
    const dx = targetNode.position.x - groupDrag.at.x;
    const dy = targetNode.position.y - groupDrag.at.y;
    const g = groupDrag;
    nodes = nodes.map((n) => {
      const origin = g.kids.get(n.id);
      return origin ? { ...n, position: { x: origin.x + dx, y: origin.y + dy } } : n;
    });
  }

  function dragStop(): void {
    groupDrag = null;
    commit();
  }

  // ---- selection, color, label, delete ----
  function onSelection({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }): void {
    selectedNodes = ns.map((n) => n.id);
    selectedEdges = es.map((e) => e.id);
  }

  function setColor(color: string | undefined): void {
    nodes = nodes.map((n) => (selectedNodes.includes(n.id) ? { ...n, data: { ...(n.data as CardData), ...(color ? { color } : { color: undefined }) } } : n));
    edges = edges.map((e) => {
      if (!selectedEdges.includes(e.id)) return e;
      const data = { ...(e.data as BoardEdge["data"]), ...(color ? { color } : { color: undefined }) };
      return decorate({ ...(e as unknown as BoardEdge), data });
    });
    commit();
  }

  const selectedEdge = $derived(selectedEdges.length === 1 ? (edges.find((e) => e.id === selectedEdges[0]) ?? null) : null);
  function setLabel(label: string): void {
    edges = edges.map((e) => (e.id === selectedEdges[0] ? { ...e, label: label === "" ? undefined : label } : e));
  }

  function removeSelected(): void {
    const ns = new Set(selectedNodes);
    const es = new Set(selectedEdges);
    nodes = nodes.filter((n) => !ns.has(n.id));
    edges = edges.filter((e) => !es.has(e.id) && !ns.has(e.source) && !ns.has(e.target));
    selectedNodes = [];
    selectedEdges = [];
    commit();
  }

  function focusNode(id: string): void {
    nodes = nodes.map((n) => ({ ...n, selected: n.id === id }));
    void flow.fitView({ nodes: [{ id }], duration: 200, maxZoom: 1.2, padding: 0.6 });
  }

  const label = (n: Node): string => {
    const d = n.data as CardData;
    return n.type === "text" ? ((d.text ?? "").split("\n")[0] || "(empty text card)") : n.type === "file" ? (imageNameOf(d.file ?? "") ? "Picture" : (noteIdOf(d.file ?? "") ?? d.file ?? "file")) : n.type === "link" ? (d.url ?? "link") : (d.label || "Group");
  };
  const kindName: Record<string, string> = { text: "Text", file: "Note", link: "Link", group: "Group" };
</script>

<svelte:window onkeydown={onKey} />

<div class="canvas-wrap" ondblclick={onPaneDoubleClick} role="presentation">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    fitView
    minZoom={0.1}
    maxZoom={2.5}
    snapGrid={[10, 10]}
    zoomOnDoubleClick={false}
    connectionMode={ConnectionMode.Loose}
    deleteKey={["Backspace", "Delete"]}
    onbeforeconnect={onBeforeConnect}
    onconnect={() => queueMicrotask(commit)}
    onconnectend={onConnectEnd}
    ondelete={commit}
    onnodedragstart={dragStart}
    onnodedrag={drag}
    onnodedragstop={dragStop}
    onselectionchange={onSelection}
  >
    <Background variant={BackgroundVariant.Dots} gap={24} />
    <Controls showLock={false} />
    <MiniMap pannable zoomable />

    <Panel position="top-left">
      <div class="bar" role="toolbar" aria-label="Canvas tools">
        <button type="button" onclick={() => add("text")} title="A card for your own words (or double-click the board)">Text</button>
        <button type="button" onclick={() => void openPicker()} aria-expanded={picking} title="Put a note on the board">Note…</button>
        <button type="button" onclick={() => fileInput?.click()} title="A picture from your computer">Image…</button>
        <button type="button" onclick={() => add("link")} title="A web address">Link</button>
        <button type="button" onclick={() => add("group")} title="A box to gather cards in">Group</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" disabled={!canUndo} onclick={undo} title="Undo (Ctrl or Cmd + Z)">Undo</button>
        <button type="button" disabled={!canRedo} onclick={redo} title="Redo (Shift + Ctrl or Cmd + Z)">Redo</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" aria-pressed={outline} onclick={() => (outline = !outline)} title="A list of everything on the board, for the keyboard">Outline</button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" bind:this={fileInput} onchange={(e) => { void addImage(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} aria-label="Choose a picture" />
      {#if imageError}<p class="img-err" role="alert">{imageError}</p>{/if}
      {#if picking}
        <div class="picker" role="dialog" aria-label="Choose a note">
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" bind:value={pickQuery} placeholder="Find a note" aria-label="Find a note" autofocus />
          <ul>
            {#each pickable as n (n.id)}
              <li><button type="button" onclick={() => addNote(n)}>{n.title}</button></li>
            {:else}
              <li class="none">No notes found.</li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if selectedNodes.length + selectedEdges.length > 0}
        <div class="bar sel" role="toolbar" aria-label="Selected">
          <span class="muted">{selectedNodes.length + selectedEdges.length} selected</span>
          {#each PRESETS as p (p)}
            <button type="button" class="swatch" style:--c={`var(--canvas-${p})`} aria-label={`Color ${PRESET_NAMES[p]}`} onclick={() => setColor(p)}></button>
          {/each}
          <button type="button" onclick={() => setColor(undefined)}>No color</button>
          {#if selectedEdge}
            <input type="text" class="label-in" value={selectedEdge.label ?? ""} placeholder="Arrow label" aria-label="Arrow label" oninput={(e) => setLabel(e.currentTarget.value)} onchange={commit} />
          {/if}
          <button type="button" class="danger" onclick={removeSelected}>Delete</button>
        </div>
      {/if}
    </Panel>

    {#if outline}
      <Panel position="top-right">
        <div class="outline" role="region" aria-label="Everything on the board">
          <strong>On this board</strong>
          <ul>
            {#each nodes as n (n.id)}
              <li><button type="button" onclick={() => focusNode(n.id)}><span class="kind">{kindName[n.type ?? "text"]}</span> {label(n)}</button></li>
            {:else}
              <li class="none">Nothing yet. Add a card.</li>
            {/each}
          </ul>
        </div>
      </Panel>
    {/if}
  </SvelteFlow>
  {#if nodes.length === 0}
    <p class="empty">An empty board. Double-click anywhere to write a card, or use <strong>Note…</strong> to bring in a note.</p>
  {/if}
</div>

<style>
  .canvas-wrap {
    position: absolute;
    inset: 0;
  }
  /* Svelte Flow's own variables, pointed at this app's tokens so light and dark both work. */
  .canvas-wrap :global(.svelte-flow) {
    --xy-background-color: var(--bg);
    --xy-background-pattern-dots-color-default: color-mix(in srgb, var(--ink) 18%, var(--bg));
    --xy-edge-stroke-default: var(--ink-muted);
    --xy-edge-stroke-selected-default: var(--ink);
    --xy-edge-label-color-default: var(--ink);
    --xy-edge-label-background-color-default: var(--bg);
    --xy-node-border-radius-default: var(--radius);
    --xy-handle-background-color-default: var(--ink);
    --xy-handle-border-color-default: var(--bg);
    --xy-selection-background-color-default: color-mix(in srgb, var(--ink) 8%, transparent);
    --xy-selection-border-default: 1px dotted var(--ink-muted);
    --xy-minimap-background-color-default: var(--surface);
    --xy-minimap-mask-background-color-default: color-mix(in srgb, var(--bg) 70%, transparent);
    --xy-controls-button-background-color-default: var(--surface);
    --xy-controls-button-background-color-hover-default: var(--surface-hover);
    --xy-controls-button-color-default: var(--ink);
    --xy-controls-button-border-color-default: var(--hairline);
    --xy-resize-background-color-default: var(--ink);
    --xy-minimap-node-background-color-default: var(--ink-muted);
    --xy-minimap-node-stroke-color-default: var(--ink-muted);
  }
  .canvas-wrap :global(.svelte-flow__node) {
    border: 0;
    background: transparent;
    padding: 0;
    box-shadow: none;
    color: var(--ink);
  }
  .canvas-wrap :global(.svelte-flow__node.selected) > :global(div:not(.svelte-flow__resize-control)) {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .canvas-wrap :global(.svelte-flow__handle) {
    opacity: 0;
    width: 10px;
    height: 10px;
  }
  .canvas-wrap :global(.svelte-flow__node:hover .svelte-flow__handle),
  .canvas-wrap :global(.svelte-flow__node.selected .svelte-flow__handle) {
    opacity: 1;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
  }
  .hidden {
    display: none;
  }
  .img-err {
    margin: var(--space-1) 0 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--err);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--err-ink);
    font-size: var(--text-label);
  }
  .sel {
    margin-top: var(--space-2);
  }
  .bar button {
    padding: var(--space-1) var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-label);
    cursor: pointer;
  }
  .bar button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .bar button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .bar button[aria-pressed="true"],
  .bar button[aria-expanded="true"] {
    border-color: var(--ink-muted);
  }
  .bar .danger {
    color: var(--err-ink);
  }
  .swatch {
    width: 20px;
    height: 20px;
    padding: 0 !important;
    border-radius: 50% !important;
    background: var(--c) !important;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--hairline);
    margin: 0 var(--space-1);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
    padding: 0 var(--space-2);
  }
  .label-in,
  .picker input {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-label);
  }
  .picker,
  .outline {
    display: grid;
    gap: var(--space-2);
    max-height: 60vh;
    width: 18rem;
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
    font-size: var(--text-label);
  }
  .picker ul,
  .outline ul {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow: auto;
  }
  .picker li button,
  .outline li button {
    width: 100%;
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .picker li button:hover,
  .outline li button:hover {
    background: var(--surface-hover);
  }
  .kind {
    color: var(--ink-muted);
    margin-right: var(--space-1);
  }
  .none {
    color: var(--ink-muted);
    padding: var(--space-1) var(--space-2);
  }
  .empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-width: 24rem;
    text-align: center;
    color: var(--ink-muted);
    pointer-events: none;
  }
</style>
