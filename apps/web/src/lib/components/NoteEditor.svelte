<script lang="ts">
  import { untrack } from "svelte";
  import type { Component } from "svelte";
  import BlockEditor from "$lib/components/BlockEditor.svelte";
  import { Button } from "$lib/ui";

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
  /** The plain markdown editor (CodeMirror) is loaded only when a note needs it. */
  let RawEditor = $state.raw<Component<Record<string, unknown>> | null>(null);
  $effect(() => {
    if (mode === "raw" && !RawEditor) void import("$lib/components/Editor.svelte").then((m) => (RawEditor = m.default as unknown as Component<Record<string, unknown>>));
  });
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

{#if mode === "raw"}
  <div class="modes">
    {#if why}<span class="why">{why}</span>{/if}
    <Button variant="ghost" size="sm" onclick={() => switchTo("blocks")}>Use blocks</Button>
  </div>
{/if}
{#if mode === "blocks"}
  {#key `${noteId}:${forced}`}
    <BlockEditor value={text} {noteId} onDocChange={remember} {onOpenWikilink} {onProblem} {getTitles} {getTitle} {onAsk} onSwitch={() => switchTo("raw")} />
  {/key}
{:else if mode === "raw" && RawEditor}
  {#key `${noteId}:${forced}`}
    <RawEditor value={text} {noteId} onDocChange={remember} {onOpenWikilink} {onProblem} {getTitles} {getTitle} {onAsk} {jumpLine} />
  {/key}
{/if}

<style>
  .modes {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--s-3);
    min-height: var(--control-h-sm);
  }
  .why {
    color: var(--text-3);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }
</style>
