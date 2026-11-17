<script lang="ts">
  import { untrack } from "svelte";
  import { Compartment, EditorState, Prec } from "@codemirror/state";
  import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
  import { minimalSetup } from "codemirror";
  import { search, searchKeymap } from "@codemirror/search";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { bodyStart, livePreview } from "$lib/editor/livePreview";
  import { addImageFiles, imageDrop } from "$lib/editor/images";
  import { uploadImage } from "$lib/api";
  import { wikilinkCompletion } from "$lib/editor/wikilinkComplete";
  import { boldCommand, clozeCommand, codeCommand, headingCommand, indentCommand, italicCommand, lineCommand, linkCommand, outdentCommand, strikeCommand } from "$lib/editor/format";
  import SelectionToolbar from "$lib/components/SelectionToolbar.svelte";
  import Code from "@lucide/svelte/icons/code";
  import Focus from "@lucide/svelte/icons/focus";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import { focusMode } from "$lib/editor/focus";
  import { outlineOf, type OutlineItem } from "$lib/editor/outline";
  import { linkPaste } from "$lib/editor/paste";
  import { tabInTable } from "$lib/editor/table";
  import PopupMenu, { type MenuItem } from "$lib/components/PopupMenu.svelte";
  import { blockHandle, moveBlockByKey } from "$lib/editor/blockHandle";
  import { blocksOf, deleteBlock, duplicateBlock, moveBlock, movedBlockStart, turnInto, type TurnInto } from "$lib/editor/blocks";

  let {
    value = "",
    noteId = "",
    onDocChange,
    onOpenWikilink,
    onProblem,
    getTitles,
    getTitle,
    onAsk,
    jumpLine = null,
  }: {
    value?: string;
    noteId?: string;
    onDocChange?: (next: string) => void;
    /** Cmd/Ctrl+click on a [[wikilink]]: the page opens or offers to create that note. */
    onOpenWikilink?: (title: string) => void;
    /** A short message when a pasted or dropped image cannot be added. */
    onProblem?: (message: string) => void;
    /** Note titles for `[[` completion, read each time the list opens. */
    getTitles?: () => string[];
    /** The note's title: a first-line `# Title` that repeats it is hidden, the page shows it already. */
    getTitle?: () => string | undefined;
    /** Cmd/Ctrl+J, the toolbar button or `/ask`: the page opens "Ask an agent" with the selected text. */
    onAsk?: (selection: string) => void;
    /** A line to scroll to and select when the note opens (1-based), for example from a cited source. */
    jumpLine?: number | null;
  } = $props();

  const selectedText = (v: EditorView): string => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);

  let host = $state<HTMLDivElement | undefined>(undefined);
  let jumped = -1;
  let view = $state.raw<EditorView | undefined>(undefined);
  let wrap = $state<HTMLDivElement | undefined>(undefined);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let fileInput = $state<HTMLInputElement | undefined>(undefined);

  // Modes the person can switch: the raw markdown (no live preview), focus on one block, and the outline list.
  const previewSlot = new Compartment();
  const focusSlot = new Compartment();
  let raw = $state(false);
  let focused = $state(false);
  let outlineOpen = $state(false);
  let outline = $state<OutlineItem[]>([]);

  function toggleRaw(): void {
    raw = !raw;
    view?.dispatch({ effects: previewSlot.reconfigure(raw ? [] : preview()) });
  }
  function toggleFocus(): void {
    focused = !focused;
    view?.dispatch({ effects: focusSlot.reconfigure(focused ? focusMode : []) });
  }
  function toggleOutline(): void {
    outlineOpen = !outlineOpen;
    if (outlineOpen && view) outline = outlineOf(view.state);
  }
  function jumpTo(item: OutlineItem): void {
    const v = view;
    if (!v) return;
    outlineOpen = false;
    v.dispatch({ selection: { anchor: item.from }, effects: EditorView.scrollIntoView(item.from, { y: "start", yMargin: 80 }) });
    v.focus();
  }

  /** Tab in a table moves between cells; anywhere else it is the list indent (see the keymap). */
  const tabCommand = (dir: 1 | -1) => (v: EditorView): boolean => {
    const spec = tabInTable(v.state, v.state.selection.main.head, dir);
    if (!spec) return false;
    v.dispatch(spec);
    return true;
  };

  /** The `/image` block: choose a picture, it is uploaded and put at the caret like a pasted one. */
  async function pickedImages(files: FileList | null): Promise<void> {
    const v = view;
    if (!v || !files) return;
    await addImageFiles(v, [...files], async (file) => (await uploadImage(file)).name, (m) => onProblem?.(m));
    v.focus();
  }

  /** The block menu: change what kind of block it is, duplicate, move or delete it. Each choice is one undo step. */
  function openBlockMenu(at: { x: number; y: number }, index: number): void {
    const v = view;
    if (!v) return;
    const fresh = () => blocksOf(v.state);
    const turn = (kind: TurnInto, label: string, hint?: string): MenuItem => ({
      label,
      ...(hint ? { hint } : {}),
      run: () => {
        const b = fresh()[index];
        if (b) v.dispatch({ changes: turnInto(v.state, b, kind), userEvent: "input" });
        v.focus();
      },
    });
    const move = (delta: -1 | 1): void => {
      const blocks = fresh();
      const changes = moveBlock(v.state, blocks, index, index + delta, delta > 0);
      if (changes.length > 0) v.dispatch({ changes, selection: { anchor: movedBlockStart(blocks, index, index + delta, delta > 0, v.state.changes(changes)) }, userEvent: "move", scrollIntoView: true });
      v.focus();
    };
    const total = fresh().length;
    menu = {
      ...at,
      items: [
        turn("text", "Text"),
        turn("h1", "Heading 1", "#"),
        turn("h2", "Heading 2", "##"),
        turn("h3", "Heading 3", "###"),
        turn("bullet", "Bulleted list", "-"),
        turn("number", "Numbered list", "1."),
        turn("todo", "To-do list", "[ ]"),
        turn("quote", "Quote", ">"),
        turn("callout", "Callout", "[!note]"),
        turn("code", "Code block", "```"),
        "-",
        { label: "Duplicate", run: () => { const b = fresh()[index]; if (b) v.dispatch({ changes: duplicateBlock(v.state, b), userEvent: "input" }); v.focus(); } },
        { label: "Move up", hint: "Alt Up", disabled: index === 0, run: () => move(-1) },
        { label: "Move down", hint: "Alt Down", disabled: index >= total - 1, run: () => move(1) },
        "-",
        { label: "Delete", danger: true, run: () => { const b = fresh()[index]; if (b) v.dispatch({ changes: deleteBlock(v.state, b), userEvent: "delete" }); v.focus(); } },
      ],
    };
  }

  /** Where the floating format toolbar sits while text is selected, relative to the editor. */
  let bar = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    const v = view;
    const n = jumpLine;
    if (!v || n === null || n === jumped) return;
    jumped = n;
    const line = v.state.doc.line(Math.min(Math.max(1, n), v.state.doc.lines));
    v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
  });

  function placeBar(v: EditorView): void {
    const sel = v.state.selection.main;
    if (sel.empty || !v.hasFocus || !wrap) {
      bar = null;
      return;
    }
    const at = v.coordsAtPos(sel.from);
    if (!at) {
      bar = null;
      return;
    }
    const box = wrap.getBoundingClientRect();
    const width = 10 * 30 + 9 * 2 + 10; // ten buttons, gaps and padding
    const left = Math.min(Math.max(0, at.left - box.left), Math.max(0, box.width - width));
    const above = at.top - box.top - 44;
    bar = { left, top: above >= 0 ? above : at.bottom - box.top + 8 };
  }

  // Keys: Mod is Cmd on a Mac and Ctrl elsewhere. Tab only acts inside a list, so it never traps keyboard focus.
  const formatKeys = Prec.high(
    keymap.of([
      { key: "Mod-b", run: boldCommand },
      { key: "Mod-i", run: italicCommand },
      { key: "Mod-e", run: codeCommand },
      { key: "Mod-Shift-x", run: strikeCommand },
      { key: "Mod-Shift-k", run: linkCommand },
      { key: "Mod-Shift-h", run: clozeCommand },
      {
        key: "Mod-j",
        run: (v) => {
          onAsk?.(selectedText(v));
          return onAsk !== undefined;
        },
      },
      { key: "Mod-Alt-1", run: headingCommand(1) },
      { key: "Mod-Alt-2", run: headingCommand(2) },
      { key: "Mod-Alt-3", run: headingCommand(3) },
      { key: "Mod-Shift-8", run: lineCommand("bullet") },
      { key: "Mod-Shift-7", run: lineCommand("number") },
      { key: "Mod-Shift-9", run: lineCommand("task") },
      { key: "Alt-ArrowUp", run: (v) => moveBlockByKey(v, -1) },
      { key: "Alt-ArrowDown", run: (v) => moveBlockByKey(v, 1) },
      { key: "Tab", run: (v) => tabCommand(1)(v) || indentCommand(v) },
      { key: "Shift-Tab", run: (v) => tabCommand(-1)(v) || outdentCommand(v) },
      { key: "Mod-Shift-o", run: () => (toggleOutline(), true) },
    ]),
  );

  // Code colours come from tokens (each checked for contrast in both themes): keywords, strings, numbers, names and types.
  const highlight = HighlightStyle.define([
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--ink-muted)", fontStyle: "italic" },
    { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: "var(--code-string)" },
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword], color: "var(--code-keyword)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))], color: "var(--code-fn)" },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)], color: "var(--code-type)" },
    { tag: [tags.propertyName, tags.attributeName], color: "var(--code-fn)" },
    { tag: tags.heading, fontWeight: "600" },
    { tag: tags.link, textDecoration: "underline" },
  ]);

  const theme = EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      color: "var(--ink)",
      fontFamily: "var(--font-serif)",
      fontSize: "var(--text-prose)",
    },
    ".cm-content": {
      fontFamily: "var(--font-serif)",
      fontSize: "var(--text-prose)",
      lineHeight: "1.75",
      caretColor: "var(--ink)",
      padding: "var(--space-2) 0 var(--space-12)",
      minHeight: "50vh",
    },
    ".cm-line": { padding: "0" },
    ".cm-scroller": {
      fontFamily: "var(--font-serif)",
      lineHeight: "1.75",
      overflow: "visible",
    },
    ".cm-placeholder": { color: "var(--ink-muted)", fontStyle: "italic" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--ink-muted)",
      border: "none",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-label)",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-muted)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--selection) !important" },
    ".cm-tooltip.cm-tooltip-autocomplete": { border: "1px solid var(--hairline)", borderRadius: "var(--radius)", backgroundColor: "var(--surface)", boxShadow: "var(--shadow-pop)", overflow: "hidden", padding: "var(--space-1)" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-chrome)", fontSize: "var(--text-ui)", maxHeight: "22em", minWidth: "17em" },
    ".cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius)", color: "var(--ink)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--surface-hover)", color: "var(--ink)" },
    ".cm-tooltip-autocomplete .cm-completionLabel": { flex: "1" },
    ".cm-tooltip-autocomplete .cm-completionDetail": { marginLeft: "var(--space-3)", color: "var(--ink-muted)", fontStyle: "normal", fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", order: "3" },
    ".cm-tooltip-autocomplete .cm-completionSection": { display: "block", padding: "var(--space-2) var(--space-2) var(--space-1)", color: "var(--ink-muted)", fontSize: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.05em" },
    ".cm-slashicon": { flex: "none", color: "var(--ink-muted)", order: "-1" },
    ".cm-panels": { backgroundColor: "transparent", color: "var(--ink)", border: "none" },
    ".cm-panels.cm-panels-top": { borderBottom: "none" },
    ".cm-search": { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", margin: "var(--space-2) 0", padding: "var(--space-2)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", backgroundColor: "var(--surface)", fontFamily: "var(--font-chrome)", fontSize: "var(--text-label)" },
    ".cm-search input, .cm-search button": { fontFamily: "inherit", fontSize: "inherit", color: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", backgroundColor: "var(--bg)", padding: "2px var(--space-2)" },
    ".cm-search button": { cursor: "pointer", backgroundColor: "transparent" },
    ".cm-search button:hover": { backgroundColor: "var(--surface-hover)" },
    ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--ink-muted)" },
    ".cm-search [name=close]": { marginLeft: "auto", border: "none" },
    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--canvas-3) 30%, transparent)", borderRadius: "2px" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--canvas-5) 45%, transparent)" },
    ".cm-blockhandle": { position: "absolute", left: "-64px", display: "none", alignItems: "center", gap: "2px", zIndex: "3" },
    ".cm-blockhandle.on": { display: "flex" },
    ".cm-blockhandle button": { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", padding: "0", border: "0", borderRadius: "var(--radius)", background: "transparent", color: "var(--ink-muted)", cursor: "pointer" },
    ".cm-blockhandle button:hover": { backgroundColor: "var(--surface-hover)", color: "var(--ink)" },
    ".cm-blockhandle button:last-child": { cursor: "grab" },
    ".cm-dropline": { position: "absolute", left: "0", right: "0", height: "2px", display: "none", backgroundColor: "var(--canvas-5)", pointerEvents: "none", zIndex: "3" },
    ".cm-dropline.on": { display: "block" },
    "&.cm-dragging, &.cm-dragging .cm-content": { cursor: "grabbing", userSelect: "none" },
    "@media (hover: none)": { ".cm-blockhandle": { display: "none !important" } },
    // The caret and the selection show where you are writing; the page needs no frame around the text.
    "&.cm-focused": { outline: "none" },
  });

  const preview = () => livePreview({ onOpenWikilink: (title) => onOpenWikilink?.(title), getTitle: () => getTitle?.() });

  $effect(() => {
    // Recreate the editor when the note changes; never while typing.
    const id = noteId;
    const initial = untrack(() => value);
    if (!host) return;
    const instance = new EditorView({
      state: EditorState.create({
        doc: initial,
        selection: { anchor: bodyStart(initial, getTitle?.()) },
        extensions: [
          formatKeys,
          minimalSetup,
          drawSelection(),
          blockHandle({ onMenu: openBlockMenu }),
          placeholder("Write, or press / for blocks"),
          syntaxHighlighting(highlight),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          wikilinkCompletion(
            () => getTitles?.() ?? [],
            onAsk ? () => onAsk(instance ? selectedText(instance) : "") : undefined,
            () => fileInput?.click(),
          ),
          previewSlot.of(preview()),
          focusSlot.of([]),
          linkPaste,
          search({ top: true }),
          keymap.of(searchKeymap),
          EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences" }),
          imageDrop(async (file) => (await uploadImage(file)).name, (m) => onProblem?.(m)),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onDocChange?.(update.state.doc.toString());
            if (update.selectionSet || update.docChanged || update.focusChanged) placeBar(update.view);
          }),
        ],
      }),
      parent: host,
    });
    view = instance;
    raw = false;
    focused = false;
    outlineOpen = false;
    void id;
    return () => {
      instance.destroy();
      if (view === instance) view = undefined;
      bar = null;
    };
  });
</script>

<div class="wrap" bind:this={wrap}>
  <div class="modes" role="toolbar" aria-label="Writing view">
    <button type="button" aria-pressed={outlineOpen} onclick={toggleOutline} title="Headings of this note (Ctrl or Cmd + Shift + O)"><ListTree size={15} strokeWidth={1.5} /> Outline</button>
    <button type="button" aria-pressed={focused} onclick={toggleFocus} title="Dim everything except the paragraph you are writing"><Focus size={15} strokeWidth={1.5} /> Focus</button>
    <button type="button" aria-pressed={raw} onclick={toggleRaw} title="Show the markdown as it is saved"><Code size={15} strokeWidth={1.5} /> Markdown</button>
    {#if outlineOpen}
      <div class="outline" role="region" aria-label="Headings">
        {#each outline as item (item.from)}
          <button type="button" class="item" style:padding-left={`${(item.level - 1) * 14 + 8}px`} onclick={() => jumpTo(item)}>{item.title}</button>
        {:else}
          <p class="none">No headings yet. Start a line with # to make one.</p>
        {/each}
      </div>
    {/if}
  </div>
  <div class="editor" bind:this={host}></div>
  {#if bar && view}
    <SelectionToolbar {view} left={bar.left} top={bar.top} onask={onAsk ? () => onAsk(selectedText(view!)) : undefined} />
  {/if}
  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" bind:this={fileInput} onchange={(e) => { void pickedImages(e.currentTarget.files); e.currentTarget.value = ""; }} aria-label="Choose a picture" />
  {#if menu}
    <PopupMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .hidden {
    display: none;
  }
  .modes {
    position: relative;
    display: flex;
    gap: var(--space-1);
    justify-content: flex-end;
    margin-bottom: var(--space-1);
  }
  .modes > button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-muted);
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    cursor: pointer;
  }
  .modes > button:hover,
  .modes > button[aria-pressed="true"] {
    color: var(--ink);
    background: var(--surface-hover);
  }
  .outline {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 20;
    display: grid;
    width: 18rem;
    max-height: 50vh;
    overflow: auto;
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
  }
  .outline .item {
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font-family: var(--font-chrome);
    font-size: var(--text-ui);
    text-align: left;
    cursor: pointer;
  }
  .outline .item:hover {
    background: var(--surface-hover);
  }
  .outline .none {
    margin: 0;
    padding: var(--space-2);
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
</style>
