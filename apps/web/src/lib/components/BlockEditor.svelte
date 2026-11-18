<script lang="ts">
  import { untrack } from "svelte";
  import { Editor, Extension } from "@tiptap/core";
  import { Selection } from "@tiptap/pm/state";
  import { Placeholder } from "@tiptap/extensions";
  import { blockExtensions } from "$lib/blocks/extensions";
  import { titleLine } from "$lib/blocks/titleLine";
  import { tidyMarkdown } from "$lib/blocks/markdownIo";
  import { tagMarks } from "$lib/blocks/tagMarks";
  import { blockHandle } from "$lib/blocks/blockHandle";
  import { deleteUnit, duplicateUnit, moveUnit, unitAt } from "$lib/blocks/moves";
  import { slashItems, type SlashItem } from "$lib/blocks/slashItems";
  import { suggest, type Popup } from "$lib/blocks/suggest";
  import { rank } from "$lib/fuzzy";
  import { imageFiles, imageProblem } from "$lib/editor/images";
  import { uploadImage } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import PopupMenu, { type MenuItem } from "$lib/components/PopupMenu.svelte";

  let {
    value = "",
    noteId = "",
    onDocChange,
    onOpenWikilink,
    onProblem,
    getTitles,
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
    /** Note titles for `[[` completion, read each time the list opens. */
    getTitles?: () => string[];
    /** The note's title: a first heading that repeats it is hidden, the page shows it already. */
    getTitle?: () => string | undefined;
    /** Cmd/Ctrl+J, the toolbar button or `/ask`: the page opens "Ask an agent" with the selected text. */
    onAsk?: (selection: string) => void;
  } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let wrap = $state<HTMLDivElement | undefined>(undefined);
  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  let editor = $state.raw<Editor | undefined>(undefined);
  /** The pop-up list under the caret (the `/` menu or the `[[` note picker). */
  let popup = $state<Popup | null>(null);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** The floating format bar over a selection; `link` turns it into a one-line address field. */
  let bar = $state<{ left: number; top: number } | null>(null);
  let link = $state<string | null>(null);
  let active = $state({ bold: false, italic: false, strike: false, code: false, link: false });

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

  // ---- the block menu (grip click) ----

  function openBlockMenu(at: { x: number; y: number }, from: number): void {
    const e = editor;
    if (!e) return;
    const unit = unitAt(e.state.doc, from + 1);
    if (!unit) return;
    const inside = (): void => {
      e.view.dispatch(e.state.tr.setSelection(Selection.near(e.state.doc.resolve(Math.min(unit.from + 1, e.state.doc.content.size)), 1)));
    };
    const turn = (label: string, hint: string, run: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>): MenuItem => ({
      label,
      hint,
      run: () => {
        inside();
        run(e.chain().focus()).run();
      },
    });
    const move = (gap: number): void => {
      const tr = e.state.tr;
      if (moveUnit(tr, unit, gap)) e.view.dispatch(tr.scrollIntoView());
      e.commands.focus();
    };
    menu = {
      ...at,
      items: [
        turn("Text", "", (c) => c.clearNodes()),
        turn("Heading 1", "#", (c) => c.clearNodes().setHeading({ level: 1 })),
        turn("Heading 2", "##", (c) => c.clearNodes().setHeading({ level: 2 })),
        turn("Heading 3", "###", (c) => c.clearNodes().setHeading({ level: 3 })),
        turn("Bulleted list", "-", (c) => c.toggleBulletList()),
        turn("Numbered list", "1.", (c) => c.toggleOrderedList()),
        turn("To-do list", "[ ]", (c) => c.toggleTaskList()),
        turn("Quote", ">", (c) => c.clearNodes().setBlockquote()),
        turn("Callout", "[!note]", (c) => c.clearNodes().wrapIn("callout", { kind: "note", fold: "", title: "" })),
        turn("Code block", "```", (c) => c.clearNodes().setCodeBlock()),
        "-",
        { label: "Duplicate", run: () => { const tr = e.state.tr; duplicateUnit(tr, unit); e.view.dispatch(tr); e.commands.focus(); } },
        { label: "Move up", hint: "Alt Up", disabled: unit.index === 0, run: () => move(unit.index - 1) },
        { label: "Move down", hint: "Alt Down", disabled: unit.index >= unit.count - 1, run: () => move(unit.index + 2) },
        "-",
        { label: "Delete", danger: true, run: () => { const tr = e.state.tr; deleteUnit(tr, unit); e.view.dispatch(tr); e.commands.focus(); } },
      ],
    };
  }

  /** The plus beside a block: a new empty line below it, with the `/` menu already open. */
  function addBelow(from: number): void {
    const e = editor;
    if (!e) return;
    const unit = unitAt(e.state.doc, from + 1);
    if (!unit) return;
    e.chain().focus().insertContentAt(unit.parent.type.name === "doc" ? unit.to : unit.to, { type: "paragraph", content: [{ type: "text", text: "/" }] }).run();
  }

  // ---- the floating format bar ----

  function placeBar(e: Editor): void {
    const { from, to, empty } = e.state.selection;
    const inCode = e.isActive("codeBlock");
    if (empty || !e.isFocused || inCode || !wrap) {
      if (link === null) bar = null;
      return;
    }
    const at = e.view.coordsAtPos(from);
    const box = wrap.getBoundingClientRect();
    const width = 8 * 32 + 20;
    const left = Math.min(Math.max(0, at.left - box.left), Math.max(0, box.width - width));
    const above = at.top - box.top - 46;
    bar = { left, top: above >= 0 ? above : e.view.coordsAtPos(to).bottom - box.top + 8 };
    active = { bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), code: e.isActive("code"), link: e.isActive("link") };
  }

  function startLink(): void {
    link = editor?.getAttributes("link").href ?? "";
  }
  function applyLink(): void {
    const e = editor;
    const href = (link ?? "").trim();
    link = null;
    if (!e) return;
    if (href === "") e.chain().focus().unsetLink().run();
    else e.chain().focus().setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}` }).run();
  }
  function cloze(): void {
    const e = editor;
    if (!e) return;
    const { from, to } = e.state.selection;
    e.chain().focus().insertContentAt({ from, to }, { type: "cloze", attrs: { raw: `{{c1::${e.state.doc.textBetween(from, to, " ")}}}` } }).run();
  }

  const bubble: { label: string; icon: "type" | "pilcrow" | "code" | "link" | "brain" | "bot"; on: () => void; pressed?: () => boolean; text?: string }[] = [
    { label: "Bold", icon: "type", text: "B", on: () => void editor?.chain().focus().toggleBold().run(), pressed: () => active.bold },
    { label: "Italic", icon: "type", text: "I", on: () => void editor?.chain().focus().toggleItalic().run(), pressed: () => active.italic },
    { label: "Strikethrough", icon: "type", text: "S", on: () => void editor?.chain().focus().toggleStrike().run(), pressed: () => active.strike },
    { label: "Code", icon: "code", on: () => void editor?.chain().focus().toggleCode().run(), pressed: () => active.code },
    { label: "Link", icon: "link", on: startLink, pressed: () => active.link },
    { label: "Study blank", icon: "brain", on: cloze },
  ];

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
            cloze();
            return !this.editor.state.selection.empty;
          },
          "Mod-Shift-k": () => {
            startLink();
            return true;
          },
          "Alt-ArrowUp": () => moveSelected(this.editor, -1),
          "Alt-ArrowDown": () => moveSelected(this.editor, 1),
        };
      },
    });

    const instance: Editor = new Editor({
      element: host,
      extensions: [
        ...blockExtensions(),
        Placeholder.configure({ placeholder: "Write, or press / for blocks" }),
        titleLine(() => getTitle?.()),
        tagMarks,
        keys,
        blockHandle({ onMenu: openBlockMenu, onAdd: addBelow }),
        suggest<SlashItem>({
          name: "slash",
          char: "/",
          allow: ({ editor: e, range }) => {
            const at = e.state.doc.resolve(range.from);
            return at.parent.type.name === "paragraph" && at.parent.textBetween(0, range.from - at.start()).trim() === "";
          },
          items: (q) => slashItems(q, { onImage: () => fileInput?.click(), ...(onAsk ? { onAsk: () => onAsk(selectedText(instance)) } : {}) }),
          describe: (i) => ({ key: i.id, label: i.label, detail: i.hint, group: i.group, icon: i.icon }),
          pick: (e, range, item) => {
            e.chain().focus().deleteRange(range).run();
            item.run(e);
            if (item.id === "wikilink") e.chain().focus().insertContent("[").run();
          },
          show: (p) => (popup = p),
        }),
        suggest<string>({
          name: "wikilink",
          char: "[[",
          allowSpaces: true,
          items: (q) => rank(getTitles?.() ?? [], q, (t) => t).slice(0, 8),
          describe: (t) => ({ key: t, label: t, icon: "link" }),
          pick: (e, range, title) => {
            e.chain().focus().deleteRange(range).insertContent([{ type: "wikilink", attrs: { target: title, label: "" } }, { type: "text", text: " " }]).run();
          },
          show: (p) => (popup = p),
        }),
      ],
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
      onUpdate: () => {
        touched();
        placeBar(instance);
      },
      onSelectionUpdate: () => placeBar(instance),
      onFocus: () => placeBar(instance),
      onBlur: () => {
        if (link === null) bar = null;
      },
    });
    editor = instance;
    return () => {
      clearTimeout(timer);
      instance.destroy();
      editor = undefined;
      popup = null;
      bar = null;
    };
  });

  /** Alt+Up and Alt+Down: the block with the caret trades places with its neighbour. */
  function moveSelected(e: Editor, delta: -1 | 1): boolean {
    const unit = unitAt(e.state.doc, e.state.selection.from);
    if (!unit) return false;
    const gap = delta < 0 ? unit.index - 1 : unit.index + 2;
    const tr = e.state.tr;
    if (!moveUnit(tr, unit, gap)) return true;
    e.view.dispatch(tr.scrollIntoView());
    return true;
  }

  const popupStyle = $derived.by(() => {
    if (!popup) return "";
    const left = Math.max(8, Math.min(popup.left, window.innerWidth - 300));
    return popup.bottom + 340 > window.innerHeight ? `bottom:${window.innerHeight - popup.top + 6}px;left:${left}px` : `top:${popup.bottom + 6}px;left:${left}px`;
  });

  const popupGroups = $derived.by(() => {
    if (!popup) return [];
    const out: { name: string; rows: { i: number; item: Popup["items"][number] }[] }[] = [];
    popup.items.forEach((item, i) => {
      const name = item.group ?? "";
      const last = out[out.length - 1];
      if (last && last.name === name) last.rows.push({ i, item });
      else out.push({ name, rows: [{ i, item }] });
    });
    return out;
  });
</script>

<div class="block-editor" bind:this={wrap}>
  <div class="host" bind:this={host}></div>

  {#if bar}
    <div class="bubble" role="toolbar" aria-label="Format selected text" style:left={`${bar.left}px`} style:top={`${bar.top}px`}>
      {#if link !== null}
        <input
          class="link-input"
          type="text"
          placeholder="Paste or type an address, Enter to apply"
          bind:value={link}
          onkeydown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              applyLink();
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              link = null;
              editor?.commands.focus();
            }
          }}
          {@attach (el) => el.focus()}
        />
      {:else}
        {#each bubble as b (b.label)}
          <button type="button" aria-label={b.label} title={b.label} aria-pressed={b.pressed?.() ?? false} class:on={b.pressed?.() ?? false} onmousedown={(ev) => ev.preventDefault()} onclick={b.on}>
            {#if b.text}<span class={`glyph g-${b.text}`}>{b.text}</span>{:else}<Icon name={b.icon} size={15} />{/if}
          </button>
        {/each}
        {#if onAsk}
          <button type="button" aria-label="Ask an agent" title="Ask an agent (Ctrl/Cmd+J)" onmousedown={(ev) => ev.preventDefault()} onclick={() => editor && onAsk(selectedText(editor))}><Icon name="bot" size={15} /></button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if popup}
  <div class="popup" role="listbox" aria-label="Blocks" style={popupStyle}>
    {#each popupGroups as g (g.name)}
      {#if g.name}<div class="group">{g.name}</div>{/if}
      {#each g.rows as { i, item } (item.key)}
        <button type="button" role="option" aria-selected={i === popup.index} class:sel={i === popup.index} onmousedown={(ev) => ev.preventDefault()} onclick={() => popup?.choose(i)}>
          {#if item.icon}<Icon name={item.icon} size={16} />{/if}
          <span class="label">{item.label}</span>
          {#if item.detail}<span class="detail">{item.detail}</span>{/if}
        </button>
      {/each}
    {/each}
  </div>
{/if}

{#if menu}
  <PopupMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<input
  bind:this={fileInput}
  type="file"
  accept="image/png,image/jpeg,image/gif,image/webp"
  multiple
  hidden
  onchange={() => {
    void addImages([...(fileInput?.files ?? [])]);
    if (fileInput) fileInput.value = "";
  }}
/>

<style>

  .block-editor {
    position: relative;
  }
  .host {
    position: relative;
  }
  .bubble {
    position: absolute;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-chrome);
  }
  .bubble button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  .bubble button:hover,
  .bubble button:focus-visible {
    background: var(--surface-hover);
  }
  .bubble button.on {
    background: var(--surface-hover);
    color: var(--canvas-5);
  }
  .glyph {
    font-family: var(--font-serif);
    font-size: 15px;
    font-weight: 700;
  }
  .g-I {
    font-style: italic;
    font-weight: 600;
  }
  .g-S {
    text-decoration: line-through;
  }
  .link-input {
    width: 280px;
    padding: 4px var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-label);
  }
  .popup {
    position: fixed;
    z-index: 30;
    width: 288px;
    max-height: 320px;
    overflow-y: auto;
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-chrome);
    font-size: var(--text-ui);
  }
  .popup .group {
    padding: var(--space-2) var(--space-2) var(--space-1);
    color: var(--ink-muted);
    font-size: var(--text-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .popup button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .popup button :global(svg) {
    flex: none;
    color: var(--ink-muted);
  }
  .popup button.sel,
  .popup button:hover {
    background: var(--surface-hover);
  }
  .popup .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .popup .detail {
    color: var(--ink-muted);
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .block-editor :global(.bh) {
    position: absolute;
    left: -60px;
    display: none;
    align-items: center;
    gap: 2px;
    z-index: 3;
  }
  .block-editor :global(.bh.on) {
    display: flex;
  }
  .block-editor :global(.bh button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .block-editor :global(.bh button:hover),
  .block-editor :global(.bh button:focus-visible) {
    background: var(--surface-hover);
    color: var(--ink);
  }
  .block-editor :global(.bh button:last-child) {
    cursor: grab;
    touch-action: none;
  }
  .block-editor :global(.bh-line) {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    display: none;
    background: var(--canvas-5);
    pointer-events: none;
    z-index: 3;
  }
  .block-editor :global(.bh-line.on) {
    display: block;
  }
  :global(body.bh-dragging) {
    cursor: grabbing;
    user-select: none;
  }
  @media (hover: none) {
    .block-editor :global(.bh) {
      display: none !important;
    }
  }
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
