<script lang="ts">
  import { getContext } from "svelte";
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { cssColor, noteIdOf, type CardData } from "$lib/canvas";
  import { CANVAS_KEY, type CanvasContext } from "./context";
  import Handles from "./Handles.svelte";

  let { data, selected }: NodeProps & { data: CardData } = $props();
  const board = getContext<CanvasContext>(CANVAS_KEY);

  const noteId = $derived(noteIdOf(data.file ?? ""));
  const info = $derived(noteId ? board.noteInfo(noteId) : null);
  $effect(() => {
    if (noteId) board.loadNote(noteId);
  });
  const color = $derived(cssColor(data.color));
</script>

<NodeResizer isVisible={selected} minWidth={160} minHeight={80} onResizeEnd={() => board.commit()} />
<div class="card" style:--accent={color} role="group" aria-label="Note card">
  {#if noteId === null}
    <p class="title">{data.file}</p>
    <p class="hint">Not a note this app can open.</p>
  {:else if info === null}
    <p class="hint">Loading…</p>
  {:else if info.missing}
    <p class="title">{noteId}</p>
    <p class="hint">This note no longer exists.</p>
  {:else}
    <a class="title nodrag" href={`/?note=${encodeURIComponent(noteId)}`} title="Open the note">{info.title}</a>
    <pre class="excerpt">{info.excerpt}</pre>
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
    align-content: start;
    gap: var(--space-2);
    border: 1.5px solid var(--accent, var(--hairline));
    border-left: 4px solid var(--accent, var(--ink-muted));
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 90%, var(--accent, var(--surface)));
    color: var(--ink);
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
    text-decoration: none;
  }
  a.title:hover {
    text-decoration: underline;
  }
  .excerpt {
    margin: 0;
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    color: var(--ink-muted);
    white-space: pre-wrap;
    overflow: hidden;
  }
  .hint {
    margin: 0;
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
</style>
