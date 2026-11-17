<script lang="ts">
  import { setContext, untrack } from "svelte";
  import { Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, MiniMap, Panel, SvelteFlow, useSvelteFlow, type Edge, type Node } from "@xyflow/svelte";
  import { getNote, listNotes, uploadImage } from "$lib/api";
  import { EDGE_STYLE_FIELD, EDGE_STYLES, History, LOCK_FIELD, PRESETS, PRESET_NAMES, SIZES, cssColor, checklistProgress, edgeStyleOf, excerpt, headingsOf, imageNameOf, isLocked, lockProps, newId, noteFile, noteIdOf, snapshot, toBoard, toFile, type BoardEdge, type BoardNode, type CanvasFile, type CanvasSide, type CardData, type CardKind } from "$lib/canvas";
  import { boundsOf, copySelection, groupAround, pasteClip, restack, type Clip } from "$lib/canvas-clipboard";
  import { alignBoxes, distributeBoxes, matchedSize, snapToObjects, type AlignHow, type Box } from "$lib/canvas-guides";
  import { refreshOnLive } from "$lib/live";
  import { relativeSpot, tidy } from "$lib/canvas-layout";
  import AlignCenterHorizontal from "@lucide/svelte/icons/align-center-horizontal";
  import AlignCenterVertical from "@lucide/svelte/icons/align-center-vertical";
  import AlignEndHorizontal from "@lucide/svelte/icons/align-end-horizontal";
  import AlignEndVertical from "@lucide/svelte/icons/align-end-vertical";
  import AlignHorizontalDistributeCenter from "@lucide/svelte/icons/align-horizontal-distribute-center";
  import AlignStartHorizontal from "@lucide/svelte/icons/align-start-horizontal";
  import AlignStartVertical from "@lucide/svelte/icons/align-start-vertical";
  import AlignVerticalDistributeCenter from "@lucide/svelte/icons/align-vertical-distribute-center";
  import MoveHorizontal from "@lucide/svelte/icons/move-horizontal";
  import MoveVertical from "@lucide/svelte/icons/move-vertical";
  import type { NoteSummary } from "@vigil/shared";
  import CanvasMenu, { type MenuItem } from "./CanvasMenu.svelte";
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
  let help = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** The card the board wants to start editing; the card itself notices and begins (see `wantsEdit`). */
  let editTarget = $state<string | null>(null);
  /** What Copy and Cut put aside, and the text that went to the system clipboard with it (null when that failed). */
  let clip: Clip | null = null;
  let clipText: string | null = "";
  let pastes = 0;
  /** Snapping: to the grid and to the edges and centres of other cards. Holding Space turns it off for one drag. */
  let snapOn = $state(readSnap());
  let spaceDown = $state(false);
  let guides = $state<{ v: number | null; h: number | null }>({ v: null, h: null });

  function readSnap(): boolean {
    try {
      return localStorage.getItem("vigil.canvas.snap") !== "off";
    } catch {
      return true; // no storage (private window): snapping stays on, it is only a preference
    }
  }
  function toggleSnap(): void {
    snapOn = !snapOn;
    try {
      localStorage.setItem("vigil.canvas.snap", snapOn ? "on" : "off");
    } catch {
      // The choice still holds for this visit; it just is not remembered.
    }
  }

  /** Arrowheads and color are display; the file keeps only what the format has. */
  function decorate(e: BoardEdge | (Edge & Partial<BoardEdge>)): Edge {
    const data = (e as BoardEdge).data;
    const color = cssColor(data?.color);
    return {
      ...(e as Edge),
      type: ({ curved: "default", straight: "straight", step: "smoothstep" } as const)[edgeStyleOf(data?.extra)],
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

  const typing = (target: EventTarget | null): boolean => {
    const t = target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  };
  const chosen = (): string[] => nodes.filter((n) => n.selected).map((n) => n.id);

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === "Space") spaceDown = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.code === "Space" && !typing(event.target)) spaceDown = true;
    if (typing(event.target) || menu) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      event.preventDefault();
      redo();
    } else if (mod && key === "c") {
      if (copy()) event.preventDefault();
    } else if (mod && key === "x") {
      if (copy()) {
        event.preventDefault();
        removeSelected();
      }
    } else if (mod && key === "d") {
      event.preventDefault();
      duplicate();
    } else if (mod && key === "a") {
      event.preventDefault();
      nodes = nodes.map((n) => ({ ...n, selected: true }));
    } else if (mod && key === "g") {
      event.preventDefault();
      groupSelection();
    } else if (event.shiftKey && !mod && event.code === "Digit1") {
      event.preventDefault();
      void flow.fitView({ duration: 200, padding: 0.15 });
    } else if (event.shiftKey && !mod && event.code === "Digit2") {
      event.preventDefault();
      zoomToSelection();
    } else if (event.key === "Tab" && !mod && !event.shiftKey && onlyCard() && (event.target as HTMLElement | null)?.closest(".svelte-flow__node, body") !== null) {
      event.preventDefault();
      addRelative("child");
    } else if (event.key === "Enter" && event.shiftKey && !mod && onlyCard()) {
      event.preventDefault();
      addRelative("sibling");
    } else if (event.key === "Enter" && !mod && !event.shiftKey) {
      const only = chosen();
      const node = only.length === 1 ? nodes.find((n) => n.id === only[0]) : undefined;
      if (node && node.type !== "file") {
        event.preventDefault();
        editTarget = node.id;
      }
    } else if (event.key === "Escape") {
      nodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      edges = edges.map((e) => (e.selected ? { ...e, selected: false } : e));
    }
  }

  /** The one selected card, when exactly one card (not a group) is selected. */
  const onlyCard = (): Node | null => {
    const ids = chosen();
    const node = ids.length === 1 ? nodes.find((n) => n.id === ids[0]) : undefined;
    return node && node.type !== "group" ? node : null;
  };

  /** Mind-map keys: Tab adds a card to the right, joined by an arrow; Shift+Enter adds one below, joined to the same parent. */
  function addRelative(kind: "child" | "sibling"): void {
    const from = onlyCard();
    if (!from) return;
    const rect = (n: Node): { x: number; y: number; width: number; height: number } => ({ x: n.position.x, y: n.position.y, width: n.width ?? n.measured?.width ?? 200, height: n.height ?? n.measured?.height ?? 100 });
    const size = SIZES.text;
    const spot = relativeSpot(rect(from), kind, nodes.filter((n) => n.type !== "group").map(rect), size);
    const id = newId("t", taken());
    const top = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0) + 1;
    const parent = kind === "child" ? from.id : edges.find((e) => e.target === from.id)?.source;
    const node: BoardNode = { id, type: "text", position: spot, width: size.width, height: size.height, zIndex: top, data: { kind: "text", extra: {} } };
    const edgeId = newId("e", taken());
    nodes = [...nodes.map((n) => ({ ...n, selected: false })), { ...(node as unknown as Node), selected: true }];
    if (parent) edges = [...edges, decorate({ id: edgeId, source: parent, target: id, sourceHandle: "right", targetHandle: "left", data: { fromEnd: "none", toEnd: "arrow", extra: {} } } as BoardEdge)];
    editTarget = id;
    commit();
  }

  /** Lays the selected cards out again, as a tree following the arrows or as a grid, keeping their top left corner. */
  function applyTidy(ids: string[], mode: "tree" | "grid"): void {
    const b = asBoard();
    const at = tidy(b.nodes.filter((n) => ids.includes(n.id)), b.edges, mode);
    if (at.size === 0) return;
    nodes = nodes.map((n) => (at.has(n.id) ? { ...n, position: at.get(n.id) ?? n.position } : n));
    commit();
    void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 250, padding: 0.3, maxZoom: 1.2 });
  }

  const boxesOf = (ids: string[]): Box[] => asBoard().nodes.filter((n) => ids.includes(n.id) && n.type !== "group").map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, width: n.width, height: n.height }));

  function moveTo(at: Map<string, { x: number; y: number }>): void {
    if (at.size === 0) return;
    nodes = nodes.map((n) => (at.has(n.id) ? { ...n, position: at.get(n.id) ?? n.position } : n));
    commit();
  }
  const align = (how: AlignHow): void => moveTo(alignBoxes(boxesOf(selectedNodes), how));
  const spread = (axis: "horizontal" | "vertical"): void => moveTo(distributeBoxes(boxesOf(selectedNodes), axis));
  function sameSize(dim: "width" | "height"): void {
    const boxes = boxesOf(selectedNodes);
    if (boxes.length < 2) return;
    const size = matchedSize(boxes, dim);
    nodes = nodes.map((n) => (boxes.some((b) => b.id === n.id) ? { ...n, [dim]: size } : n));
    commit();
  }

  // ---- copy, cut, paste, duplicate ----
  const plainText = (n: BoardNode): string => (n.type === "text" ? (n.data.text ?? "") : n.type === "link" ? (n.data.url ?? "") : n.type === "group" ? (n.data.label ?? "") : (n.data.file ?? ""));

  /** Puts the selected cards aside (and their words on the system clipboard). False when nothing is selected. */
  function copy(): boolean {
    const ids = chosen();
    if (ids.length === 0) return false;
    const b = asBoard();
    clip = copySelection(b.nodes, b.edges, ids);
    pastes = 0;
    const text = clip.nodes.map(plainText).filter((t) => t !== "").join("\n\n");
    clipText = text;
    // If the browser refuses the system clipboard, the cards are still ours to paste: null means "always paste ours".
    void navigator.clipboard.writeText(text).catch(() => (clipText = null));
    return true;
  }

  function place(c: Clip, offset: { x: number; y: number }): void {
    const top = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0);
    const out = pasteClip(c, taken(), offset, top);
    nodes = [...nodes.map((n) => ({ ...n, selected: false })), ...out.nodes.map((n) => ({ ...(n as unknown as Node), selected: true }))];
    edges = [...edges.map((e) => ({ ...e, selected: false })), ...out.edges.map((e) => decorate(e as unknown as BoardEdge))];
    commit();
  }

  /** Pastes what Copy put aside: a little down and right each time, or with its top left corner at `at`. */
  function pasteCards(at?: { x: number; y: number }): void {
    if (!clip) return;
    pastes += 1;
    const box = boundsOf(clip.nodes);
    place(clip, at && box ? { x: at.x - box.x, y: at.y - box.y } : { x: 24 * pastes, y: 24 * pastes });
  }

  function duplicate(ids: string[] = chosen()): void {
    if (ids.length === 0) return;
    const b = asBoard();
    place(copySelection(b.nodes, b.edges, ids), { x: 24, y: 24 });
  }

  const asUrl = (text: string): string | null => {
    const first = text.split("\n").find((l) => l.trim() !== "" && !l.startsWith("#"))?.trim() ?? "";
    return /^https?:\/\/\S+$/i.test(first) ? first : null;
  };

  function onPaste(event: ClipboardEvent): void {
    if (typing(event.target)) return;
    const data = event.clipboardData;
    if (!data) return;
    const images = [...data.files].filter((f) => f.type.startsWith("image/"));
    const text = data.getData("text/plain");
    event.preventDefault();
    if (images.length > 0) {
      images.forEach((f, i) => void addImage(f, nextSpot(i)));
    } else if (clip && (clipText === null || text === clipText)) {
      pasteCards();
    } else if (asUrl(text)) {
      add("link", { url: asUrl(text) ?? "" });
    } else if (text.trim() !== "") {
      add("text", { text });
    } else {
      pasteCards();
    }
  }

  /** Where the next card goes when you did not point: where you are looking, one step further for each in a row. */
  const nextSpot = (i: number): { x: number; y: number } => {
    const c = center({ width: 0, height: 0 });
    return { x: c.x + i * 24, y: c.y + i * 24 };
  };

  // ---- dropping pictures and addresses from outside the app ----
  function onDragOver(event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    if (types.includes("Files") || types.includes("text/uri-list")) event.preventDefault();
  }

  function onDrop(event: DragEvent): void {
    const dt = event.dataTransfer;
    if (!dt) return;
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const images = [...dt.files].filter((f) => f.type.startsWith("image/"));
    const url = asUrl(dt.getData("text/uri-list") || dt.getData("text/plain"));
    if (images.length === 0 && !url) return;
    event.preventDefault();
    if (images.length > 0) images.forEach((f, i) => void addImage(f, { x: Math.round(at.x + i * 24), y: Math.round(at.y + i * 24) }));
    else if (url) add("link", { url }, { x: Math.round(at.x - SIZES.link.width / 2), y: Math.round(at.y - SIZES.link.height / 2) });
  }

  // ---- group, lock, stacking, view ----
  function groupSelection(): void {
    const g = groupAround(asBoard().nodes, chosen(), taken());
    if (!g) return;
    nodes = [{ ...(g as unknown as Node), selected: true }, ...nodes.map((n) => ({ ...n, selected: false }))];
    editTarget = g.id;
    commit();
  }

  function toggleLock(ids: string[]): void {
    const targets = nodes.filter((n) => ids.includes(n.id));
    if (targets.length === 0) return;
    const lock = !targets.every((n) => isLocked(n as unknown as BoardNode));
    nodes = nodes.map((n) => {
      if (!ids.includes(n.id)) return n;
      const d = n.data as CardData;
      const extra = { ...d.extra };
      if (lock) extra[LOCK_FIELD] = true;
      else delete extra[LOCK_FIELD];
      return { ...n, ...(lock ? lockProps(true) : { draggable: true, deletable: true }), data: { ...d, extra } };
    });
    commit();
  }

  function stack(ids: string[], to: "front" | "back"): void {
    const order = restack(asBoard().nodes, ids, to);
    nodes = nodes.map((n) => ({ ...n, zIndex: order.get(n.id) ?? n.zIndex }));
    commit();
  }

  function zoomToSelection(): void {
    const ids = chosen();
    void flow.fitView({ ...(ids.length > 0 ? { nodes: ids.map((id) => ({ id })) } : {}), duration: 200, padding: 0.3, maxZoom: 1.5 });
  }

  // ---- right-click menus ----
  const at = (e: MouseEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY });

  function openMenu(event: MouseEvent, items: MenuItem[]): void {
    event.preventDefault();
    menu = { ...at(event), items };
  }

  function onPaneMenu({ event }: { event: MouseEvent }): void {
    const p = flow.screenToFlowPosition(at(event));
    const spot = (w: number, h: number): { x: number; y: number } => ({ x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) });
    openMenu(event, [
      { label: "Add text card", run: () => add("text", {}, spot(SIZES.text.width, SIZES.text.height)) },
      { label: "Add note…", run: () => void openPicker() },
      { label: "Add picture…", run: () => fileInput?.click() },
      { label: "Add link", run: () => add("link", {}, spot(SIZES.link.width, SIZES.link.height)) },
      { label: "Add group", run: () => add("group", {}, spot(SIZES.group.width, SIZES.group.height)) },
      "-",
      { label: "Paste", hint: "Ctrl/Cmd V", disabled: clip === null, run: () => pasteCards({ x: Math.round(p.x), y: Math.round(p.y) }) },
      { label: "Select all", hint: "Ctrl/Cmd A", disabled: nodes.length === 0, run: () => (nodes = nodes.map((n) => ({ ...n, selected: true }))) },
      { label: "Fit everything", hint: "Shift 1", run: () => void flow.fitView({ duration: 200, padding: 0.15 }) },
    ]);
  }

  function cardMenu(event: MouseEvent, ids: string[]): void {
    const only = ids.length === 1 ? nodes.find((n) => n.id === ids[0]) : undefined;
    const locked = ids.length > 0 && ids.every((id) => isLocked(nodes.find((n) => n.id === id) as unknown as BoardNode));
    openMenu(event, [
      ...(only && only.type !== "file" ? [{ label: only.type === "group" ? "Rename" : "Edit", hint: "Enter", run: () => (editTarget = only.id) } satisfies MenuItem] : []),
      { label: "Duplicate", hint: "Ctrl/Cmd D", run: () => duplicate(ids) },
      { label: "Copy", hint: "Ctrl/Cmd C", run: () => copy() },
      { label: "Cut", hint: "Ctrl/Cmd X", run: () => { if (copy()) removeSelected(); } },
      "-",
      { label: "Bring to front", run: () => stack(ids, "front") },
      { label: "Send to back", run: () => stack(ids, "back") },
      { label: locked ? "Unlock" : "Lock in place", run: () => toggleLock(ids) },
      ...(only && only.type === "file" ? narrowItems(only) : []),
      ...(ids.length > 1 ? [{ label: "Tidy as a tree", run: () => applyTidy(ids, "tree") } satisfies MenuItem, { label: "Tidy as a grid", run: () => applyTidy(ids, "grid") } satisfies MenuItem] : []),
      { label: "Zoom to", hint: "Shift 2", run: () => void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 200, padding: 0.3, maxZoom: 1.5 }) },
      "-",
      { label: "Delete", hint: "Del", danger: true, disabled: locked, run: removeSelected },
    ]);
  }

  /** For a note card: show only the part under one heading, or the whole note again. */
  function narrowItems(node: Node): MenuItem[] {
    const d = node.data as CardData;
    const noteId = noteIdOf(d.file ?? "");
    const body = noteId ? (info[noteId]?.body ?? "") : "";
    if (!noteId || body === "") return [];
    const set = (subpath: string | undefined): void => {
      nodes = nodes.map((n) => (n.id === node.id ? { ...n, data: { ...(n.data as CardData), ...(subpath ? { subpath } : { subpath: undefined }) } } : n));
      commit();
    };
    return [
      "-",
      ...(d.subpath ? [{ label: "Show the whole note", run: () => set(undefined) } satisfies MenuItem] : []),
      ...headingsOf(body).slice(0, 12).map((h): MenuItem => ({ label: `Only “${h.title.slice(0, 28)}”`, hint: d.subpath && d.subpath.replace(/^#+\s*/, "").toLowerCase() === h.title.toLowerCase() ? "now" : "", run: () => set(`#${h.title}`) })),
    ];
  }

  function onNodeMenu({ event, node }: { event: MouseEvent; node: Node }): void {
    if (!node.selected) nodes = nodes.map((n) => ({ ...n, selected: n.id === node.id }));
    selectedNodes = chosen().includes(node.id) ? chosen() : [node.id];
    cardMenu(event, selectedNodes);
  }

  function onSelectionMenu({ event, nodes: ns }: { event: MouseEvent; nodes: Node[] }): void {
    cardMenu(event, ns.map((n) => n.id));
  }

  const look = (edge: Edge, which: "end" | "start" | "both" | "none"): string => {
    const d = edge.data as BoardEdge["data"];
    const now = d.fromEnd === "arrow" && d.toEnd === "arrow" ? "both" : d.fromEnd === "arrow" ? "start" : d.toEnd === "none" ? "none" : "end";
    return now === which ? "now" : "";
  };

  function onEdgeMenu({ event, edge }: { event: MouseEvent; edge: Edge }): void {
    edges = edges.map((e) => ({ ...e, selected: e.id === edge.id }));
    nodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    selectedEdges = [edge.id];
    openMenu(event, [
      { label: "Edit label", run: () => setTimeout(() => document.querySelector<HTMLInputElement>(".label-in")?.focus(), 60) },
      { label: "Go to the card it points at", run: () => focusNode(edge.target) },
      "-",
      { label: "Arrow at the end", hint: look(edge, "end"), run: () => setEdgeLook({ fromEnd: "none", toEnd: "arrow" }) },
      { label: "Arrow at the start", hint: look(edge, "start"), run: () => setEdgeLook({ fromEnd: "arrow", toEnd: "none" }) },
      { label: "Arrows at both ends", hint: look(edge, "both"), run: () => setEdgeLook({ fromEnd: "arrow", toEnd: "arrow" }) },
      { label: "No arrowheads", hint: look(edge, "none"), run: () => setEdgeLook({ fromEnd: "none", toEnd: "none" }) },
      "-",
      { label: "Curved line", hint: edgeStyleOf((edge.data as BoardEdge["data"]).extra) === "curved" ? "now" : "", run: () => setEdgeLook({ style: "curved" }) },
      { label: "Straight line", hint: edgeStyleOf((edge.data as BoardEdge["data"]).extra) === "straight" ? "now" : "", run: () => setEdgeLook({ style: "straight" }) },
      { label: "Right-angle line", hint: edgeStyleOf((edge.data as BoardEdge["data"]).extra) === "step" ? "now" : "", run: () => setEdgeLook({ style: "step" }) },
      "-",
      { label: "Delete", hint: "Del", danger: true, run: removeSelected },
    ]);
  }

  // ---- notes shown on cards ----
  type NoteInfo = { title: string; body: string; missing: boolean };
  const info = $state<Record<string, NoteInfo | null>>({});
  const noteInfo = (noteId: string): NoteInfo | null => info[noteId] ?? null;
  function loadNote(noteId: string): void {
    if (noteId in info) return;
    info[noteId] = null;
    void getNote(noteId)
      .then((n) => (info[noteId] = { title: n.title, body: n.body, missing: false }))
      .catch(() => (info[noteId] = { title: noteId, body: "", missing: true }));
  }

  /** A note changed (you, or an agent): the cards that show it read it again. */
  async function refreshNotes(): Promise<void> {
    for (const id of Object.keys(info)) {
      info[id] = await getNote(id).then(
        (n): NoteInfo => ({ title: n.title, body: n.body, missing: false }),
        (): NoteInfo => ({ title: id, body: "", missing: true }),
      );
    }
  }
  $effect(() => refreshOnLive(refreshNotes, ["note"], 5000));

  setContext<CanvasContext>(CANVAS_KEY, {
    update(id, patch) {
      nodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data as CardData), ...patch } } : n));
    },
    commit,
    noteInfo,
    loadNote,
    wantsEdit: () => editTarget,
    clearEdit: () => (editTarget = null),
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
    const writes = (kind === "text" && !data.text) || (kind === "link" && !data.url);
    const id = newId(kind[0] ?? "n", taken());
    const top = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0) + 1;
    const node: BoardNode = { id, type: kind, position: at ?? center(size), width: size.width, height: size.height, zIndex: kind === "group" ? 0 : top, data: { kind, extra: {}, ...data } };
    nodes = [...nodes.map((n) => ({ ...n, selected: false })), { ...(node as unknown as Node), selected: true }];
    if (writes) editTarget = id;
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
  async function addImage(file: File | undefined, at?: { x: number; y: number }): Promise<void> {
    if (!file) return;
    imageError = "";
    try {
      const up = await uploadImage(file);
      add("file", { file: `attachments/${up.name}` }, at);
    } catch (err) {
      imageError = err instanceof Error ? err.message.replace(/^[a-z-]+: /, "") : "Could not add the picture";
    }
  }

  const pickable = $derived(notes.filter((n) => pickQuery.trim() === "" || n.title.toLowerCase().includes(pickQuery.trim().toLowerCase())).slice(0, 40));

  function onPaneDoubleClick(event: MouseEvent): void {
    const edgeEl = (event.target as HTMLElement).closest<HTMLElement>(".svelte-flow__edge");
    if (edgeEl?.dataset.id) {
      const id = edgeEl.dataset.id;
      edges = edges.map((e) => ({ ...e, selected: e.id === id }));
      nodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      selectedEdges = [id];
      setTimeout(() => document.querySelector<HTMLInputElement>(".label-in")?.focus(), 60);
      return;
    }
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
    if (!el && document.elementFromPoint(point.clientX, point.clientY)?.closest(".svelte-flow__pane")) {
      addConnectedCard(state.fromNode.id, state.fromHandle?.id ?? "right", flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }));
      return;
    }
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

  /** An arrow let go on the empty board makes a new card there, joined to the card it came from, as in Obsidian. */
  function addConnectedCard(fromId: string, fromSide: string, at: { x: number; y: number }): void {
    const size = SIZES.text;
    const opposite: Record<string, CanvasSide> = { right: "left", left: "right", top: "bottom", bottom: "top" };
    const toSide = opposite[fromSide] ?? "left";
    const x = toSide === "left" ? at.x : toSide === "right" ? at.x - size.width : at.x - size.width / 2;
    const y = toSide === "top" ? at.y : toSide === "bottom" ? at.y - size.height : at.y - size.height / 2;
    const id = newId("t", taken());
    const top = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0) + 1;
    const node: BoardNode = { id, type: "text", position: { x: Math.round(x), y: Math.round(y) }, width: size.width, height: size.height, zIndex: top, data: { kind: "text", extra: {} } };
    const edgeId = newId("e", taken());
    nodes = [...nodes.map((n) => ({ ...n, selected: false })), { ...(node as unknown as Node), selected: true }];
    edges = [...edges, decorate({ id: edgeId, source: fromId, target: id, sourceHandle: fromSide, targetHandle: toSide, data: { fromEnd: "none", toEnd: "arrow", extra: {} } } as BoardEdge)];
    editTarget = id;
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

  function dragStart({ targetNode, nodes: moving, event }: { targetNode: Node | null; nodes: Node[]; event: MouseEvent | TouchEvent }): void {
    groupDrag = null;
    // Holding Alt while you start a drag leaves a copy behind, as in Obsidian.
    if ("altKey" in event && event.altKey && moving.length > 0) {
      const b = asBoard();
      const top = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0);
      const out = pasteClip(copySelection(b.nodes, b.edges, moving.map((n) => n.id)), taken(), { x: 0, y: 0 }, top);
      nodes = [...nodes, ...out.nodes.map((n) => ({ ...(n as unknown as Node), selected: false }))];
      edges = [...edges, ...out.edges.map((e) => decorate(e as unknown as BoardEdge))];
    }
    if (!targetNode || targetNode.type !== "group") return;
    const kids = new Map<string, { x: number; y: number }>();
    for (const n of nodes) if (n.id !== targetNode.id && n.type !== "group" && inside(targetNode, n)) kids.set(n.id, { ...n.position });
    groupDrag = { id: targetNode.id, at: { ...targetNode.position }, kids };
  }

  /** While one card is dragged: nudge it onto the edges and centres of its neighbours and show the guide lines. */
  function snapDrag(target: Node): void {
    if (!snapOn || spaceDown) {
      guides = { v: null, h: null };
      return;
    }
    const size = (n: Node): { width: number; height: number } => ({ width: n.width ?? n.measured?.width ?? 0, height: n.height ?? n.measured?.height ?? 0 });
    const moving = { ...target.position, ...size(target) };
    const others = nodes.filter((n) => n.id !== target.id && n.type !== "group").map((n) => ({ ...n.position, ...size(n) }));
    const snap = snapToObjects(moving, others, 6 / Math.max(0.1, flow.getViewport().zoom));
    if (snap.dx !== 0 || snap.dy !== 0) nodes = nodes.map((n) => (n.id === target.id ? { ...n, position: { x: target.position.x + snap.dx, y: target.position.y + snap.dy } } : n));
    const wrap = document.querySelector(".canvas-wrap")?.getBoundingClientRect();
    const screen = flow.flowToScreenPosition({ x: snap.vertical ?? 0, y: snap.horizontal ?? 0 });
    guides = { v: snap.vertical === null ? null : screen.x - (wrap?.left ?? 0), h: snap.horizontal === null ? null : screen.y - (wrap?.top ?? 0) };
  }

  function drag({ targetNode, nodes: moving }: { targetNode: Node | null; nodes: Node[] }): void {
    if (targetNode && !groupDrag && moving.length <= 1 && targetNode.type !== "group") snapDrag(targetNode);
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
    guides = { v: null, h: null };
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

  /** Changes how the selected arrows look: which ends have arrowheads, or the line style (kept in a Vigil field). */
  function setEdgeLook(patch: { fromEnd?: "none" | "arrow"; toEnd?: "none" | "arrow"; style?: (typeof EDGE_STYLES)[number] }): void {
    edges = edges.map((e) => {
      if (!selectedEdges.includes(e.id)) return e;
      const d = e.data as BoardEdge["data"];
      const extra = { ...d.extra };
      if (patch.style === "curved") delete extra[EDGE_STYLE_FIELD];
      else if (patch.style) extra[EDGE_STYLE_FIELD] = patch.style;
      const data = { ...d, ...(patch.fromEnd ? { fromEnd: patch.fromEnd } : {}), ...(patch.toEnd ? { toEnd: patch.toEnd } : {}), extra };
      return decorate({ ...(e as unknown as BoardEdge), ...(e.label ? { label: e.label as string } : {}), data });
    });
    commit();
  }

  const selectedEdge = $derived(selectedEdges.length === 1 ? (edges.find((e) => e.id === selectedEdges[0]) ?? null) : null);
  function setLabel(label: string): void {
    edges = edges.map((e) => (e.id === selectedEdges[0] ? { ...e, label: label === "" ? undefined : label } : e));
  }

  function removeSelected(): void {
    const locked = new Set(nodes.filter((n) => isLocked(n as unknown as BoardNode)).map((n) => n.id));
    const ns = new Set(selectedNodes.filter((id) => !locked.has(id)));
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

<svelte:window onkeydown={onKey} onkeyup={onKeyUp} onpaste={onPaste} />

<div class="canvas-wrap" ondblclick={onPaneDoubleClick} ondragover={onDragOver} ondrop={onDrop} role="presentation">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    fitView
    minZoom={0.1}
    maxZoom={2.5}
    snapGrid={snapOn && !spaceDown ? [10, 10] : undefined}
    zoomOnDoubleClick={false}
    zoomOnScroll={false}
    panOnScroll
    panOnDrag={[1]}
    selectionOnDrag
    panActivationKey="Space"
    multiSelectionKey={["Shift", "Meta", "Control"]}
    onpanecontextmenu={onPaneMenu}
    onnodecontextmenu={onNodeMenu}
    onselectioncontextmenu={onSelectionMenu}
    onedgecontextmenu={onEdgeMenu}
    connectionMode={ConnectionMode.Loose}
    deleteKey={["Backspace", "Delete"]}
    onbeforeconnect={onBeforeConnect}
    onconnect={() => queueMicrotask(commit)}
    onconnectend={onConnectEnd}
    ondelete={commit}
    onreconnectend={() => commit()}
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
        <button type="button" aria-pressed={snapOn} onclick={toggleSnap} title="Snap cards to the grid and to each other (hold Space while dragging to turn it off)">Snap</button>
        <button type="button" aria-pressed={outline} onclick={() => (outline = !outline)} title="A list of everything on the board, for the keyboard">Outline</button>
        <button type="button" aria-pressed={help} onclick={() => (help = !help)} title="Keys and mouse">Keys</button>
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
          {#if selectedNodes.length > 1}
            <span class="sep" aria-hidden="true"></span>
            <button type="button" class="icon" aria-label="Align left" title="Align left" onclick={() => align("left")}><AlignStartVertical size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Align centre" title="Align centre" onclick={() => align("center")}><AlignCenterVertical size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Align right" title="Align right" onclick={() => align("right")}><AlignEndVertical size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Align top" title="Align top" onclick={() => align("top")}><AlignStartHorizontal size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Align middle" title="Align middle" onclick={() => align("middle")}><AlignCenterHorizontal size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Align bottom" title="Align bottom" onclick={() => align("bottom")}><AlignEndHorizontal size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Same width" title="Make all as wide as the widest" onclick={() => sameSize("width")}><MoveHorizontal size={16} strokeWidth={1.5} /></button>
            <button type="button" class="icon" aria-label="Same height" title="Make all as tall as the tallest" onclick={() => sameSize("height")}><MoveVertical size={16} strokeWidth={1.5} /></button>
            {#if selectedNodes.length > 2}
              <button type="button" class="icon" aria-label="Space evenly across" title="Even gaps left to right" onclick={() => spread("horizontal")}><AlignHorizontalDistributeCenter size={16} strokeWidth={1.5} /></button>
              <button type="button" class="icon" aria-label="Space evenly down" title="Even gaps top to bottom" onclick={() => spread("vertical")}><AlignVerticalDistributeCenter size={16} strokeWidth={1.5} /></button>
            {/if}
            <span class="sep" aria-hidden="true"></span>
            <button type="button" onclick={() => applyTidy(selectedNodes, "tree")} title="Lay the selected cards out following their arrows">Tidy tree</button>
            <button type="button" onclick={() => applyTidy(selectedNodes, "grid")} title="Lay the selected cards out in rows">Tidy grid</button>
          {/if}
          {#if selectedEdge}
            <input type="text" class="label-in" value={selectedEdge.label ?? ""} placeholder="Arrow label" aria-label="Arrow label" oninput={(e) => setLabel(e.currentTarget.value)} onchange={commit} />
          {/if}
          <button type="button" class="danger" onclick={removeSelected}>Delete</button>
        </div>
      {/if}
    </Panel>

    {#if outline || help}
      <Panel position="top-right">
        {#if help}
          <div class="outline help" role="region" aria-label="Keys and mouse">
            <strong>Keys and mouse</strong>
            <dl>
              <dt>Double-click the board</dt><dd>New text card</dd>
              <dt>Right-click</dt><dd>Menu for the board, a card or an arrow</dd>
              <dt>Drag on the board</dt><dd>Select with a box</dd>
              <dt>Space + drag, or scroll</dt><dd>Move around</dd>
              <dt>Ctrl/Cmd + scroll</dt><dd>Zoom</dd>
              <dt>Shift 1 / Shift 2</dt><dd>Fit all / zoom to selection</dd>
              <dt>Ctrl/Cmd C, X, V</dt><dd>Copy, cut, paste</dd>
              <dt>Ctrl/Cmd D</dt><dd>Duplicate</dd>
              <dt>Ctrl/Cmd A</dt><dd>Select all</dd>
              <dt>Ctrl/Cmd G</dt><dd>Group the selection</dd>
              <dt>Enter</dt><dd>Edit the selected card</dd>
              <dt>Tab</dt><dd>New card to the right, joined by an arrow (Esc first to move focus on)</dd>
              <dt>Shift Enter</dt><dd>New card below, joined to the same parent</dd>
              <dt>Esc</dt><dd>Clear the selection</dd>
              <dt>Ctrl/Cmd Z</dt><dd>Undo (add Shift to redo)</dd>
            </dl>
            <p class="none">Paste a web address for a link card, a picture for a picture card. Drop pictures and addresses on the board.</p>
          </div>
        {/if}
        {#if outline}
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
        {/if}
      </Panel>
    {/if}
  </SvelteFlow>
  {#if guides.v !== null}<div class="guide vertical" style:left={`${guides.v}px`} aria-hidden="true"></div>{/if}
  {#if guides.h !== null}<div class="guide horizontal" style:top={`${guides.h}px`} aria-hidden="true"></div>{/if}
  {#if menu}
    <CanvasMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
  {/if}
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
  .bar .icon {
    display: inline-flex;
    padding: var(--space-1) !important;
  }
  .guide {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    background: var(--canvas-5);
  }
  .guide.vertical {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .guide.horizontal {
    left: 0;
    right: 0;
    height: 1px;
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
  .help dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    overflow: auto;
  }
  .help dt {
    font-family: var(--font-mono);
  }
  .help dd {
    margin: 0;
    color: var(--ink-muted);
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
