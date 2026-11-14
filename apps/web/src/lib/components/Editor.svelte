<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { basicSetup } from "codemirror";
  import { markdown } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";

  let {
    value = "",
    noteId = "",
    onDocChange,
  }: {
    value?: string;
    noteId?: string;
    onDocChange?: (next: string) => void;
  } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view = $state.raw<EditorView | undefined>(undefined);

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
          basicSetup,
          markdown({ codeLanguages: languages }),
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
