<script lang="ts">
  import { getContext } from "svelte";
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { checklistProgress, cssColor, toggleTask, type CardData } from "$lib/canvas";
  import { renderMarkdown } from "$lib/render";
  import { CANVAS_KEY, type CanvasContext } from "./context";
  import Handles from "./Handles.svelte";

  let { id, data, selected }: NodeProps & { data: CardData } = $props();
  const board = getContext<CanvasContext>(CANVAS_KEY);

  let editing = $state(false);
  let draft = $state("");
  let area = $state<HTMLTextAreaElement | undefined>(undefined);
  const color = $derived(cssColor(data.color));
  const progress = $derived(checklistProgress(data.text ?? ""));

  /** The rendered checkboxes are disabled by the markdown renderer; here they work, so a list can be ticked without opening the card. */
  function checks(node: HTMLElement, _text: string): { update: (t: string) => void } {
    const run = (): void => node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((c) => (c.disabled = false));
    run();
    return { update: run };
  }

  function onTick(event: MouseEvent): void {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    event.preventDefault();
    const boxes = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const index = boxes.indexOf(box);
    if (index < 0) return;
    board.update(id, { text: toggleTask(data.text ?? "", index) });
    board.commit();
  }

  function start(): void {
    draft = data.text ?? "";
    editing = true;
    queueMicrotask(() => area?.focus());
  }

  $effect(() => {
    if (board.wantsEdit() === id) {
      board.clearEdit();
      start();
    }
  });

  function finish(save: boolean): void {
    editing = false;
    if (save && draft !== (data.text ?? "")) {
      board.update(id, { text: draft });
      board.commit();
    }
  }
</script>

<NodeResizer isVisible={selected} minWidth={120} minHeight={60} onResizeEnd={() => board.commit()} />
<div class="node" class:scrolls={selected} style:--accent={color} ondblclick={start} role="group" aria-label="Text card">
  {#if editing}
    <textarea
      bind:this={area}
      bind:value={draft}
      class="nodrag nopan nowheel"
      aria-label="Card text (Markdown)"
      onblur={() => finish(true)}
      onkeydown={(e) => {
        if (e.key === "Escape") finish(false);
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finish(true);
        e.stopPropagation();
      }}
    ></textarea>
  {:else if (data.text ?? "").trim() === ""}
    <p class="hint">Double-click to write</p>
  {:else}
    <div class="prose" class:nowheel={selected} use:checks={data.text ?? ""} onclick={onTick} role="presentation">{@html renderMarkdown(data.text ?? "")}</div>
    {#if progress}
      <div class="progress" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <span class="bar"><span class="fill" style:width={`${(progress.done / progress.total) * 100}%`}></span></span>
        <span class="count">{progress.done}/{progress.total}</span>
      </div>
    {/if}
  {/if}
</div>
<Handles />

<style>
  .node {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: hidden;
    padding: var(--s-3);
    border: 1.5px solid var(--accent, var(--line-soft));
    border-radius: var(--r-control);
    background: color-mix(in srgb, var(--paper-float) 90%, var(--accent, var(--paper-float)));
    color: var(--text);
    font-size: var(--type-ui-size);
  }
  .node.scrolls {
    overflow: auto;
  }
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    font-family: var(--font-prose);
    font-weight: 600;
    line-height: 1.25;
    margin: 0 0 var(--s-1);
  }
  .prose :global(h1) {
    font-size: var(--type-heading-size);
  }
  .prose :global(h2) {
    font-size: calc(var(--type-ui-size) * 1.15);
  }
  .prose :global(h3) {
    font-size: var(--type-ui-size);
  }
  .prose :global(code) {
    padding: 0 var(--s-1);
    border-radius: var(--r-control);
    background: var(--fill-selected);
    font-family: var(--font-code);
    font-size: 0.9em;
  }
  .prose :global(pre) {
    margin: 0 0 var(--s-2);
    padding: var(--s-2);
    border-radius: var(--r-control);
    background: var(--fill-selected);
    overflow: auto;
  }
  .prose :global(pre code) {
    padding: 0;
    background: transparent;
  }
  .prose :global(blockquote) {
    margin: 0 0 var(--s-2);
    padding: var(--s-1) var(--s-3);
    border-radius: var(--r-control);
    background: var(--fill-hover);
    color: var(--text-2);
  }
  .prose :global(table) {
    border-collapse: collapse;
    margin: 0 0 var(--s-2);
    font-size: var(--type-meta-size);
  }
  .prose :global(th),
  .prose :global(td) {
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--line-soft);
    text-align: left;
  }
  .prose :global(a) {
    color: var(--text);
    text-decoration: underline;
  }
  .prose :global(hr) {
    border: 0;
    border-top: 1px solid var(--line-soft);
  }
  .prose :global(p) {
    margin: 0 0 var(--s-2);
  }
  .prose :global(ul),
  .prose :global(ol) {
    margin: 0 0 var(--s-2);
    padding-left: var(--s-4);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
  .bar {
    flex: 1;
    height: 4px;
    border-radius: var(--r-pill);
    background: var(--line-soft);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--canvas-4);
  }
  .count {
    color: var(--text-2);
    font-size: var(--type-meta-size);
  }
  .prose :global(input[type="checkbox"]) {
    cursor: pointer;
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 0;
    resize: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
  }
  .hint {
    color: var(--text-2);
    margin: 0;
  }
</style>
