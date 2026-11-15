<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { minimalSetup } from "codemirror";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { livePreview } from "$lib/editor/livePreview";
  import { wikilinkCompletion } from "$lib/editor/wikilinkComplete";

  let {
    value = "",
    noteId = "",
    onDocChange,
    onOpenWikilink,
    getTitles,
  }: {
    value?: string;
    noteId?: string;
    onDocChange?: (next: string) => void;
    /** Cmd/Ctrl+click on a [[wikilink]]: the page opens or offers to create that note. */
    onOpenWikilink?: (title: string) => void;
    /** Note titles for `[[` completion, read each time the list opens. */
    getTitles?: () => string[];
  } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view = $state.raw<EditorView | undefined>(undefined);

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
          minimalSetup,
          syntaxHighlighting(highlight),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          wikilinkCompletion(() => getTitles?.() ?? []),
          livePreview({ onOpenWikilink: (title) => onOpenWikilink?.(title) }),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onDocChange?.(update.state.doc.toString());
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
    };
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
</style>
