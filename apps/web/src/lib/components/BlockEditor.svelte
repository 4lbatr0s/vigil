<script lang="ts">
  import { untrack } from "svelte";
  import { Editor, Extension } from "@tiptap/core";
  import { Placeholder } from "@tiptap/extensions";
  import { blockExtensions } from "$lib/blocks/extensions";
  import { titleLine } from "$lib/blocks/titleLine";
  import { tidyMarkdown } from "$lib/blocks/markdownIo";
  import { tagMarks } from "$lib/blocks/tagMarks";
  import { imageFiles, imageProblem } from "$lib/editor/images";
  import { uploadImage } from "$lib/api";

  let {
    value = "",
    noteId = "",
    onDocChange,
    onOpenWikilink,
    onProblem,
    getTitle,
    onAsk,
  }: {
    value?: string;
    noteId?: string;
    onDocChange?: (next: string) => void;
    /** Cmd/Ctrl+click on a [[wikilink]]: the page opens or offers to create that note. */
    onOpenWikilink?: (title: string) => void;
    /** A short message when a pasted or dropped image cannot be added. */
    onProblem?: (message: string) => void;
    /** The note's title: a first heading that repeats it is hidden, the page shows it already. */
    getTitle?: () => string | undefined;
    /** Cmd/Ctrl+J: the page opens "Ask an agent" with the selected text. */
    onAsk?: (selection: string) => void;
  } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let editor = $state.raw<Editor | undefined>(undefined);

  async function addImages(files: File[]): Promise<void> {
    for (const file of files) {
      const problem = imageProblem(file);
      if (problem) {
        onProblem?.(problem);
        continue;
      }
      try {
        const name = (await uploadImage(file)).name;
        editor?.chain().focus().setImage({ src: `attachments/${name}` }).run();
      } catch (err) {
        onProblem?.(err instanceof Error ? err.message : "Could not add the image.");
      }
    }
  }

  const selectedText = (e: Editor): string => e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, "\n");

  $effect(() => {
    // Recreate the editor when the note changes; never while typing.
    void noteId;
    const initial = untrack(() => value);
    if (!host) return;

    // The note is written back as the person types. A very long note is written in short pauses instead.
    let dirty = false;
    let slow = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      clearTimeout(timer);
      if (!dirty || !instance) return;
      dirty = false;
      const t0 = performance.now();
      onDocChange?.(tidyMarkdown(instance.getMarkdown()));
      slow = performance.now() - t0 > 8;
    };
    const touched = (): void => {
      dirty = true;
      if (slow) {
        clearTimeout(timer);
        timer = setTimeout(flush, 150);
      } else {
        flush();
      }
    };

    const keys = Extension.create({
      name: "vigilKeys",
      addKeyboardShortcuts() {
        return {
          "Mod-j": () => {
            if (!onAsk) return false;
            onAsk(selectedText(this.editor));
            return true;
          },
          "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
          "Mod-Shift-h": () => {
            const { from, to, empty } = this.editor.state.selection;
            if (empty) return false;
            const text = this.editor.state.doc.textBetween(from, to, " ");
            return this.editor.chain().focus().insertContentAt({ from, to }, { type: "cloze", attrs: { raw: `{{c1::${text}}}` } }).run();
          },
        };
      },
    });

    const instance: Editor = new Editor({
      element: host,
      extensions: [...blockExtensions(), Placeholder.configure({ placeholder: "Write, or press / for blocks" }), titleLine(() => getTitle?.()), tagMarks, keys],
      content: initial,
      contentType: "markdown",
      editorProps: {
        attributes: { spellcheck: "true", autocapitalize: "sentences", "aria-label": "Note text" },
        handleDOMEvents: {
          click: (_view, event) => {
            if (!(event.metaKey || event.ctrlKey) || !(event.target instanceof HTMLElement)) return false;
            const wiki = event.target.closest<HTMLElement>("[data-wikilink]");
            if (wiki) {
              onOpenWikilink?.(wiki.dataset.wikilink ?? "");
              return true;
            }
            const a = event.target.closest<HTMLAnchorElement>("a[href]");
            if (a && /^https?:\/\//.test(a.href)) {
              window.open(a.href, "_blank", "noopener,noreferrer");
              return true;
            }
            return false;
          },
          blur: () => {
            flush();
            return false;
          },
        },
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData);
          if (files.length > 0) {
            event.preventDefault();
            void addImages(files);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain").trim() ?? "";
          if (/^https?:\/\/\S+$/.test(text) && !instance.state.selection.empty) {
            instance.chain().setLink({ href: text }).run();
            return true;
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = imageFiles(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          void addImages(files);
          return true;
        },
      },
      onUpdate: touched,
    });
    editor = instance;
    return () => {
      clearTimeout(timer);
      instance.destroy();
      editor = undefined;
    };
  });
</script>

<div class="block-editor" bind:this={host}></div>

<style>
  .block-editor {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    line-height: 1.75;
    color: var(--ink);
    min-height: 50vh;
    padding: var(--space-2) 0 var(--space-12);
  }
  .block-editor :global(.tiptap) {
    outline: none;
    min-height: 50vh;
  }
  .block-editor :global(.tiptap ::selection) {
    background: var(--selection);
  }
  .block-editor :global(.tiptap > *:first-child) {
    margin-top: 0;
  }
  .block-editor :global(.tiptap p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--ink-muted);
    font-style: italic;
    pointer-events: none;
  }
  .block-editor :global(.title-dup) {
    display: none;
  }
  .block-editor :global(p) {
    margin: 0 0 var(--space-2);
  }
  .block-editor :global(h1) {
    font-size: var(--text-h1);
    font-weight: 600;
    line-height: 1.2;
    margin: 1.1em 0 0.25em;
  }
  .block-editor :global(h2) {
    font-size: var(--text-h2);
    font-weight: 600;
    line-height: 1.25;
    margin: 0.95em 0 0.2em;
  }
  .block-editor :global(h3) {
    font-size: var(--text-h3);
    font-weight: 600;
    line-height: 1.3;
    margin: 0.8em 0 0.15em;
  }
  .block-editor :global(strong) {
    font-weight: 700;
  }
  .block-editor :global(s) {
    text-decoration: line-through;
    color: var(--ink-muted);
  }
  .block-editor :global(a) {
    color: var(--code-fn);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
    cursor: text;
  }
  .block-editor :global(code) {
    font-family: var(--font-mono);
    font-size: 0.86em;
    background: var(--surface-hover);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .block-editor :global(hr) {
    border: 0;
    border-top: 1px solid var(--hairline);
    margin: var(--space-6) 0;
  }
  .block-editor :global(blockquote) {
    margin: var(--space-2) 0;
    padding-left: var(--space-4);
    border-left: 3px solid var(--hairline);
    color: var(--ink-muted);
  }
  .block-editor :global(ul),
  .block-editor :global(ol) {
    margin: 0 0 var(--space-2);
    padding-left: 1.5em;
  }
  .block-editor :global(li > ul),
  .block-editor :global(li > ol) {
    margin: 0;
  }
  .block-editor :global(.tag) {
    color: var(--ink-muted);
    font-family: var(--font-chrome);
    font-size: 0.85em;
    background: var(--surface-hover);
    border-radius: 999px;
    padding: 1px 8px;
  }
  .block-editor :global(li > p) {
    margin: 0;
  }
  .block-editor :global(li::marker) {
    color: var(--ink-muted);
  }
  .block-editor :global(ul[data-type="taskList"]) {
    list-style: none;
    padding-left: 0;
  }
  .block-editor :global(ul[data-type="taskList"] ul[data-type="taskList"]) {
    padding-left: 1.6em;
  }
  .block-editor :global(ul[data-type="taskList"] > li) {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .block-editor :global(ul[data-type="taskList"] > li > label) {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 1.75em;
    user-select: none;
  }
  .block-editor :global(ul[data-type="taskList"] > li > div) {
    flex: 1;
    min-width: 0;
  }
  .block-editor :global(ul[data-type="taskList"] input[type="checkbox"]) {
    appearance: none;
    margin: 0;
    width: 1.05em;
    height: 1.05em;
    border: 1.5px solid var(--ink-muted);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    display: grid;
    place-content: center;
  }
  .block-editor :global(ul[data-type="taskList"] input[type="checkbox"]:hover) {
    border-color: var(--ink);
  }
  .block-editor :global(ul[data-type="taskList"] input[type="checkbox"]:focus-visible) {
    outline: 2px solid var(--canvas-5);
    outline-offset: 2px;
  }
  .block-editor :global(ul[data-type="taskList"] input[type="checkbox"]:checked) {
    background: var(--canvas-4);
    border-color: var(--canvas-4);
  }
  .block-editor :global(ul[data-type="taskList"] input[type="checkbox"]:checked::after) {
    content: "";
    width: 0.3em;
    height: 0.55em;
    border: solid var(--bg);
    border-width: 0 2px 2px 0;
    transform: translateY(-1px) rotate(45deg);
  }
  .block-editor :global(ul[data-type="taskList"] > li[data-checked="true"] > div) {
    text-decoration: line-through;
    color: var(--ink-muted);
  }
  .block-editor :global(pre) {
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: 0.86em;
    line-height: 1.6;
    overflow-x: auto;
  }
  .block-editor :global(pre code) {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  .block-editor :global(.hljs-comment),
  .block-editor :global(.hljs-quote) {
    color: var(--ink-muted);
    font-style: italic;
  }
  .block-editor :global(.hljs-keyword),
  .block-editor :global(.hljs-selector-tag),
  .block-editor :global(.hljs-literal) {
    color: var(--code-keyword);
  }
  .block-editor :global(.hljs-string),
  .block-editor :global(.hljs-regexp),
  .block-editor :global(.hljs-symbol) {
    color: var(--code-string);
  }
  .block-editor :global(.hljs-number),
  .block-editor :global(.hljs-attr) {
    color: var(--code-number);
  }
  .block-editor :global(.hljs-title),
  .block-editor :global(.hljs-function),
  .block-editor :global(.hljs-property) {
    color: var(--code-fn);
  }
  .block-editor :global(.hljs-type),
  .block-editor :global(.hljs-built_in),
  .block-editor :global(.hljs-class) {
    color: var(--code-type);
  }
  .block-editor :global(img) {
    display: block;
    max-width: 100%;
    max-height: 480px;
    margin: var(--space-3) 0;
    border-radius: var(--radius);
  }
  .block-editor :global(img.ProseMirror-selectednode) {
    outline: 2px solid var(--canvas-5);
  }
  .block-editor :global(.tableWrapper) {
    margin: var(--space-3) 0;
    overflow-x: auto;
  }
  .block-editor :global(table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.94em;
  }
  .block-editor :global(th),
  .block-editor :global(td) {
    border: 1px solid var(--hairline);
    padding: var(--space-2) var(--space-3);
    vertical-align: top;
    text-align: left;
    min-width: 5em;
  }
  .block-editor :global(th) {
    background: var(--surface);
    font-weight: 600;
  }
  .block-editor :global(td > p),
  .block-editor :global(th > p) {
    margin: 0;
  }
  .block-editor :global(.selectedCell) {
    background: var(--selection);
  }
  .block-editor :global(.wikilink) {
    color: var(--ink);
    background: var(--surface-hover);
    border-bottom: 1px solid var(--ink-muted);
    border-radius: 3px;
    padding: 0 3px;
    text-decoration: none;
    cursor: pointer;
  }
  .block-editor :global(.cloze) {
    background: var(--surface-hover);
    border-bottom: 1px dashed var(--ink-muted);
    border-radius: 4px;
    padding: 0 2px;
  }
  .block-editor :global(.callout) {
    --tone: var(--canvas-5);
    margin: var(--space-3) 0;
    border-left: 3px solid var(--tone);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: color-mix(in srgb, var(--tone) 9%, var(--surface));
    padding: var(--space-2) var(--space-4);
  }
  .block-editor :global(.callout-tip),
  .block-editor :global(.callout-ok) {
    --tone: var(--canvas-4);
  }
  .block-editor :global(.callout-warn) {
    --tone: var(--canvas-2);
  }
  .block-editor :global(.callout-danger) {
    --tone: var(--canvas-1);
  }
  .block-editor :global(.callout-head) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-chrome);
    color: var(--tone);
  }
  .block-editor :global(.callout-icon) {
    display: inline-flex;
  }
  .block-editor :global(.callout-title) {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--ink);
    padding: 2px 0;
  }
  .block-editor :global(.callout-title:focus) {
    outline: none;
  }
  .block-editor :global(.callout-title::placeholder) {
    color: var(--tone);
    opacity: 1;
  }
  .block-editor :global(.callout-fold) {
    display: inline-flex;
    align-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    transform: rotate(90deg);
    transition: transform 0.12s;
  }
  .block-editor :global(.callout-fold[hidden]) {
    display: none;
  }
  .block-editor :global(.callout.closed .callout-fold) {
    transform: rotate(0deg);
  }
  .block-editor :global(.callout.closed .callout-body) {
    display: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .block-editor :global(.callout-fold) {
      transition: none;
    }
  }
</style>
