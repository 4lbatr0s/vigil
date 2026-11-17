<script lang="ts">
  import { getContext } from "svelte";
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { cssColor, type CardData } from "$lib/canvas";
  import { CANVAS_KEY, type CanvasContext } from "./context";
  import Handles from "./Handles.svelte";

  let { id, data, selected }: NodeProps & { data: CardData } = $props();
  const board = getContext<CanvasContext>(CANVAS_KEY);

  let editing = $state(false);
  let draft = $state("");
  const color = $derived(cssColor(data.color));

  function finish(save: boolean): void {
    editing = false;
    if (save && draft !== (data.label ?? "")) {
      board.update(id, { label: draft });
      board.commit();
    }
  }
</script>

<NodeResizer isVisible={selected} minWidth={160} minHeight={100} onResizeEnd={() => board.commit()} />
<div class="group" style:--accent={color} role="group" aria-label={data.label ? `Group ${data.label}` : "Group"}>
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="nodrag"
      type="text"
      bind:value={draft}
      aria-label="Group name"
      autofocus
      onblur={() => finish(true)}
      onkeydown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
        e.stopPropagation();
      }}
    />
  {:else}
    <button type="button" class="label nodrag" ondblclick={() => ((draft = data.label ?? ""), (editing = true))} title="Double-click to rename">{data.label || "Group"}</button>
  {/if}
</div>
<Handles />

<style>
  .group {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 1.5px dashed var(--accent, var(--ink-muted));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent, var(--ink-muted)) 7%, transparent);
  }
  .label {
    margin: var(--space-2);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent, var(--ink-muted)) 18%, var(--bg));
    color: var(--ink);
    font: inherit;
    font-size: var(--text-label);
    cursor: text;
  }
  input {
    margin: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-label);
  }
</style>
