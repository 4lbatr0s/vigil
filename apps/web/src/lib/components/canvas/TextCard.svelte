<script lang="ts">
  import { getContext } from "svelte";
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { cssColor, type CardData } from "$lib/canvas";
  import { renderMarkdown } from "$lib/render";
  import { CANVAS_KEY, type CanvasContext } from "./context";
  import Handles from "./Handles.svelte";

  let { id, data, selected }: NodeProps & { data: CardData } = $props();
  const board = getContext<CanvasContext>(CANVAS_KEY);

  let editing = $state(false);
  let draft = $state("");
  let area = $state<HTMLTextAreaElement | undefined>(undefined);
  const color = $derived(cssColor(data.color));

  function start(): void {
    draft = data.text ?? "";
    editing = true;
    queueMicrotask(() => area?.focus());
  }

  function finish(save: boolean): void {
    editing = false;
    if (save && draft !== (data.text ?? "")) {
      board.update(id, { text: draft });
      board.commit();
    }
  }
</script>

<NodeResizer isVisible={selected} minWidth={120} minHeight={60} onResizeEnd={() => board.commit()} />
<div class="card" style:--accent={color} ondblclick={start} role="group" aria-label="Text card">
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
    <div class="prose">{@html renderMarkdown(data.text ?? "")}</div>
  {/if}
</div>
<Handles />

<style>
  .card {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: auto;
    padding: var(--space-3);
    border: 1.5px solid var(--accent, var(--hairline));
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 90%, var(--accent, var(--surface)));
    color: var(--ink);
    font-size: var(--text-ui);
  }
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    font-size: var(--text-ui);
    font-weight: 600;
    margin: 0 0 var(--space-1);
  }
  .prose :global(p) {
    margin: 0 0 var(--space-2);
  }
  .prose :global(ul),
  .prose :global(ol) {
    margin: 0 0 var(--space-2);
    padding-left: var(--space-4);
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 0;
    resize: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    outline: none;
  }
  .hint {
    color: var(--ink-muted);
    margin: 0;
  }
</style>
