<script lang="ts">
  import "@xyflow/svelte/dist/style.css";
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { SvelteFlowProvider } from "@xyflow/svelte";
  import { ApiError, getCanvas, saveCanvas } from "$lib/api";
  import type { CanvasFile } from "$lib/canvas";
  import CanvasBoard from "$lib/components/canvas/CanvasBoard.svelte";

  type Status = "saved" | "saving" | "unsaved" | "conflict" | "failed";

  const id = $derived(page.params.id ?? "");
  let file = $state<CanvasFile | null>(null);
  let baseUpdatedAt = $state<string | undefined>(undefined);
  let loadError = $state("");
  let status = $state<Status>("saved");
  let detail = $state("");
  let reloadKey = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: CanvasFile | null = null;

  async function load(): Promise<void> {
    loadError = "";
    try {
      const doc = await getCanvas(id);
      file = doc.canvas;
      baseUpdatedAt = doc.updatedAt;
      status = "saved";
      reloadKey++;
    } catch (err) {
      loadError = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not open this canvas";
    }
  }
  onMount(() => void load());
  onDestroy(() => {
    clearTimeout(timer);
    // A change made less than a moment ago is still saved when you leave.
    if (pending) void flush();
  });

  function changed(next: CanvasFile): void {
    pending = next;
    if (status !== "conflict") status = "unsaved";
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 800);
  }

  async function flush(): Promise<void> {
    const body = pending;
    if (!body || status === "conflict") return;
    pending = null;
    status = "saving";
    try {
      const saved = await saveCanvas(id, body, baseUpdatedAt);
      baseUpdatedAt = saved.updatedAt;
      status = pending ? "unsaved" : "saved";
    } catch (err) {
      if (err instanceof ApiError && err.code === "canvas-conflict") {
        status = "conflict";
        detail = err.detail;
      } else {
        status = "failed";
        detail = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
        pending = pending ?? body; // keep it so the next change (or a retry) saves it
      }
    }
  }

  const statusText = $derived(status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved changes" : status === "conflict" ? "Changed elsewhere" : "Could not save");
</script>

<svelte:head><title>{id} · Canvas · Vigil</title></svelte:head>

<div class="page">
  <header>
    <a class="crumb" href="/canvas">Canvas</a>
    <span class="name">{id}</span>
    <span class="status" class:bad={status === "conflict" || status === "failed"} role="status" aria-live="polite">{statusText}</span>
    {#if status === "failed"}<button type="button" class="ghost" onclick={() => void flush()}>Try again</button>{/if}
  </header>
  {#if status === "conflict" || status === "failed"}
    <p class="notice" role="alert">
      {detail}
      {#if status === "conflict"}<button type="button" class="ghost" onclick={() => void load()}>Reload the newer version</button>{/if}
    </p>
  {/if}
  <div class="board">
    {#if loadError}
      <p class="error" role="alert">{loadError} <a href="/canvas">Back to all boards</a></p>
    {:else if file}
      {#key reloadKey}
        <SvelteFlowProvider>
          <CanvasBoard initial={file} onChange={changed} />
        </SvelteFlowProvider>
      {/key}
    {:else}
      <p class="muted pad">Loading…</p>
    {/if}
  </div>
</div>

<style>
  .page {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--hairline);
    font-size: var(--text-ui);
  }
  .crumb {
    color: var(--ink-muted);
  }
  .name {
    font-family: var(--font-serif);
    font-weight: 600;
  }
  .status {
    margin-left: auto;
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .status.bad {
    color: var(--err-ink);
  }
  .notice {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--hairline);
    color: var(--err-ink);
    font-size: var(--text-label);
  }
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .pad,
  .error {
    padding: var(--space-6);
  }
  .muted {
    color: var(--ink-muted);
  }
  .error {
    color: var(--err-ink);
  }
  .ghost {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-label);
    cursor: pointer;
  }
</style>
