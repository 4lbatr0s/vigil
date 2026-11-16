<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { minimalSetup } from "codemirror";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { livePreview } from "$lib/editor/livePreview";
  import { wikilinkCompletion } from "$lib/editor/wikilinkComplete";
  import { boldCommand, clozeCommand, codeCommand, headingCommand, indentCommand, italicCommand, lineCommand, linkCommand, outdentCommand, strikeCommand } from "$lib/editor/format";
  import SelectionToolbar from "$lib/components/SelectionToolbar.svelte";

  let {
    value = "",
    noteId = "",
    onDocChange,
    onOpenWikilink,
    getTitles,
    getTitle,
    onAsk,
  }: {
    value?: string;
    noteId?: string;
    onDocChange?: (next: string) => void;
    /** Cmd/Ctrl+click on a [[wikilink]]: the page opens or offers to create that note. */
    onOpenWikilink?: (title: string) => void;
    /** Note titles for `[[` completion, read each time the list opens. */
    getTitles?: () => string[];
    /** The note's title: a first-line `# Title` that repeats it is hidden, the page shows it already. */
    getTitle?: () => string | undefined;
    /** Cmd/Ctrl+J, the toolbar button or `/ask`: the page opens "Ask an agent" with the selected text. */
    onAsk?: (selection: string) => void;
  } = $props();

  const selectedText = (v: EditorView): string => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view = $state.raw<EditorView | undefined>(undefined);
  let wrap = $state<HTMLDivElement | undefined>(undefined);
  /** Where the floating format toolbar sits while text is selected, relative to the editor. */
  let bar = $state<{ left: number; top: number } | null>(null);

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
      { key: "Tab", run: indentCommand },
      { key: "Shift-Tab", run: outdentCommand },
    ]),
  );

  // Code colors come from tokens too: ink for code, muted for comments and strings, bold for keywords.
  const highlight = HighlightStyle.define([
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--ink-muted)", fontStyle: "italic" },
    { tag: [tags.string, tags.regexp], color: "var(--ink-muted)" },
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], fontWeight: "600" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--ink)" },
    { tag: tags.heading, fontWeight: "600" },
    { tag: tags.link, textDecoration: "underline" },
  ]);

  const theme = EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      color: "var(--ink)",
      fontFamily: "var(--font-serif)",
      fontSize: "var(--text-prose)",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-serif)",
      fontSize: "var(--text-prose)",
      lineHeight: "1.6",
      caretColor: "var(--ink)",
      padding: "0",
      maxWidth: "var(--measure)",
      margin: "0 auto",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-serif)",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--ink-muted)",
      border: "none",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-label)",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-muted)" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "var(--hairline) !important" },
    "&.cm-focused": { outline: "2px solid var(--ink)", outlineOffset: "-2px" },
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
          syntaxHighlighting(highlight),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          wikilinkCompletion(
            () => getTitles?.() ?? [],
            onAsk ? () => onAsk(instance ? selectedText(instance) : "") : undefined,
          ),
          livePreview({ onOpenWikilink: (title) => onOpenWikilink?.(title), getTitle: () => getTitle?.() }),
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
</div>

<style>
  .wrap {
    position: relative;
    height: 100%;
  }

  .editor {
    height: 100%;
    overflow: hidden;
  }
</style>
