<script lang="ts">
  import { getContext } from "svelte";
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { checklistProgress, cssColor, excerpt, imageNameOf, noteIdOf, sectionOf, type CardData } from "$lib/canvas";
  import { CANVAS_KEY, type CanvasContext } from "./context";
  import Handles from "./Handles.svelte";

  let { data, selected }: NodeProps & { data: CardData } = $props();
  const board = getContext<CanvasContext>(CANVAS_KEY);

  const noteId = $derived(noteIdOf(data.file ?? ""));
  const image = $derived(imageNameOf(data.file ?? ""));
  const info = $derived(noteId ? board.noteInfo(noteId) : null);
  $effect(() => {
    if (noteId) board.loadNote(noteId);
  });
  const color = $derived(cssColor(data.color));
  /** The note, or only the part under the chosen heading ("narrow to heading"). */
  const shown = $derived(info && !info.missing ? (data.subpath ? sectionOf(info.body, data.subpath) : info.body) : "");
  const progress = $derived(checklistProgress(shown));
  const part = $derived(data.subpath ? data.subpath.replace(/^#+\s*/, "") : "");
</script>

<NodeResizer isVisible={selected} minWidth={160} minHeight={80} onResizeEnd={() => board.commit()} />
<div class="node" class:pic={image !== null} style:--accent={color} role="group" aria-label={image ? "Picture card" : "Note card"}>
  {#if image}
    <img src={`/api/attachments/${image}`} alt="" draggable="false" />
  {:else if noteId === null}
    <p class="title">{data.file}</p>
    <p class="hint">Not a note this app can open.</p>
  {:else if info === null}
    <p class="hint">Loading…</p>
  {:else if info.missing}
    <p class="title">{noteId}</p>
    <p class="hint">This note no longer exists.</p>
  {:else}
    <a class="title nodrag" href={`/?note=${encodeURIComponent(noteId)}`} title="Open the note">{info.title}{#if part}<span class="part"> › {part}</span>{/if}</a>
    <pre class="excerpt">{excerpt(shown)}</pre>
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
    display: grid;
    align-content: start;
    gap: var(--s-2);
    border: 1.5px solid var(--accent, var(--line-soft));
    border-radius: var(--r-control);
    background: color-mix(in srgb, var(--paper-float) 90%, var(--accent, var(--paper-float)));
    color: var(--text);
  }
  .node.pic {
    padding: 0;
    border-left-width: 1.5px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .title {
    font-family: var(--font-prose);
    font-size: var(--type-body-size);
    font-weight: 600;
    color: var(--text);
    margin: 0;
    text-decoration: none;
  }
  a.title:hover {
    text-decoration: underline;
  }
  .excerpt {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--type-meta-size);
    color: var(--text-2);
    white-space: pre-wrap;
    overflow: hidden;
  }
  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--type-meta-size);
  }
  .part {
    font-weight: 400;
    color: var(--text-2);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: var(--s-2);
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
</style>
