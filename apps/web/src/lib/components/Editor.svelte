<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState, Prec } from "@codemirror/state";
  import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
  import { minimalSetup } from "codemirror";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { livePreview } from "$lib/editor/livePreview";
  import { addImageFiles, imageDrop } from "$lib/editor/images";
  import { uploadImage } from "$lib/api";
  import { wikilinkCompletion } from "$lib/editor/wikilinkComplete";
  import { boldCommand, clozeCommand, codeCommand, headingCommand, indentCommand, italicCommand, lineCommand, linkCommand, outdentCommand, strikeCommand } from "$lib/editor/format";
  import SelectionToolbar from "$lib/components/SelectionToolbar.svelte";
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
      { key: "Tab", run: indentCommand },
      { key: "Shift-Tab", run: outdentCommand },
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

  $effect(() => {
    // Recreate the editor when the note changes; never while typing.
    const id = noteId;
    const initial = untrack(() => value);
    if (!host) return;
    const instance = new EditorView({
      state: EditorState.create({
        doc: initial,
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
          livePreview({ onOpenWikilink: (title) => onOpenWikilink?.(title), getTitle: () => getTitle?.() }),
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
    void id;
    return () => {
      instance.destroy();
      if (view === instance) view = undefined;
      bar = null;
    };
  });
</script>

<div class="wrap" bind:this={wrap}>
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
</style>
