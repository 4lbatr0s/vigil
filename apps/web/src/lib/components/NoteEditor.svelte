<script lang="ts">
  import { untrack } from "svelte";
  import Editor from "$lib/components/Editor.svelte";
  import BlockEditor from "$lib/components/BlockEditor.svelte";

  let {
    value = "",
    noteId = "",
    onDocChange,
    onOpenWikilink,
    onProblem,
    getTitles,
    getTitle,
    onAsk,
    jumpLine = null,
  }: {
    value?: string;
    noteId?: string;
    onDocChange?: (next: string) => void;
    onOpenWikilink?: (title: string) => void;
    onProblem?: (message: string) => void;
    getTitles?: () => string[];
    getTitle?: () => string | undefined;
    onAsk?: (selection: string) => void;
    jumpLine?: number | null;
  } = $props();

  /**
   * The note opens in the block editor when it can be written back exactly as it is; otherwise (syntax the block
   * editor would change, or a jump to a cited line) it opens as plain markdown. The person can switch either way.
   */
  let mode = $state<"checking" | "blocks" | "raw">("checking");
  let why = $state("");
  let text = $state(untrack(() => value));
  let forced = $state<"blocks" | "raw" | null>(null);

  function remember(next: string): void {
    text = next;
    onDocChange?.(next);
  }

  $effect(() => {
    void noteId;
    const start = untrack(() => value);
    const jump = untrack(() => jumpLine);
    text = start;
    forced = null;
    mode = "checking";
    why = "";
    let live = true;
    void import("$lib/blocks/markdownIo").then(({ roundTrips }) => {
      if (!live) return;
      if (jump !== null) {
        why = "Opened as markdown to jump to the line.";
        mode = "raw";
      } else if (roundTrips(start)) {
        mode = "blocks";
      } else {
        why = "Opened as markdown to keep your text exactly as it is.";
        mode = "raw";
      }
    });
    return () => {
      live = false;
    };
  });

  function switchTo(next: "blocks" | "raw"): void {
    forced = next;
    why = "";
    mode = next;
  }
</script>

<div class="modes">
  {#if why}<span class="why">{why}</span>{/if}
  {#if mode === "blocks"}
    <button type="button" onclick={() => switchTo("raw")} title="Edit the plain markdown text">Markdown</button>
  {:else if mode === "raw"}
    <button type="button" onclick={() => switchTo("blocks")} title="Edit with blocks">Blocks</button>
  {/if}
</div>
{#if mode === "blocks"}
  {#key `${noteId}:${forced}`}
    <BlockEditor value={text} {noteId} onDocChange={remember} {onOpenWikilink} {onProblem} {getTitles} {getTitle} {onAsk} />
  {/key}
{:else if mode === "raw"}
  {#key `${noteId}:${forced}`}
    <Editor value={text} {noteId} onDocChange={remember} {onOpenWikilink} {onProblem} {getTitles} {getTitle} {onAsk} {jumpLine} />
  {/key}
{/if}

<style>
  .modes {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-3);
    min-height: 28px;
    font-family: var(--font-chrome);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .modes button {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    padding: 2px var(--space-2);
    cursor: pointer;
  }
  .modes button:hover,
  .modes button:focus-visible {
    background: var(--surface-hover);
    color: var(--ink);
  }
</style>
