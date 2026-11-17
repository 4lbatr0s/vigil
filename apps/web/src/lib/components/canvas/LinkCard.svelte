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
  /** Only web addresses become links; anything else (a `javascript:` address, say) is shown as text. */
  const safe = $derived(/^https?:\/\//i.test(data.url ?? ""));

  $effect(() => {
    if (board.wantsEdit() === id) {
      board.clearEdit();
      draft = data.url ?? "";
      editing = true;
    }
  });

  function finish(save: boolean): void {
    editing = false;
    if (save && draft.trim() !== (data.url ?? "")) {
      board.update(id, { url: draft.trim() });
      board.commit();
    }
  }
</script>

<NodeResizer isVisible={selected} minWidth={140} minHeight={50} onResizeEnd={() => board.commit()} />
<div class="card" style:--accent={color} ondblclick={() => ((draft = data.url ?? ""), (editing = true))} role="group" aria-label="Link card">
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="nodrag"
      type="text"
      bind:value={draft}
      aria-label="Web address"
      autofocus
      onblur={() => finish(true)}
      onkeydown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
        e.stopPropagation();
      }}
    />
  {:else if safe}
    <a class="nodrag" href={data.url} target="_blank" rel="noopener noreferrer">{data.url}</a>
  {:else}
    <span>{data.url || "Double-click to add a web address"}</span>
  {/if}
</div>
<Handles />

<style>
  .card {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: hidden;
    padding: var(--space-3);
    display: grid;
    align-content: center;
    border: 1.5px solid var(--accent, var(--hairline));
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 90%, var(--accent, var(--surface)));
    font-size: var(--text-label);
    overflow-wrap: anywhere;
  }
  a {
    color: var(--ink);
  }
  span {
    color: var(--ink-muted);
  }
  input {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }
</style>
