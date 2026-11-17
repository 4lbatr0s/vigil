<script lang="ts">
  import type { Run } from "@vigil/shared";
  import { ApiError, undoRun, type ApprovalItem } from "$lib/api";
  import { relativeTime } from "$lib/note-list";

  let {
    agentName,
    writtenAt,
    run,
    pending = [],
    onundone,
    onreview,
  }: {
    agentName: string | undefined;
    /** The note's last change, when an agent wrote it. */
    writtenAt: string | undefined;
    /** The run to view or undo, when known. */
    run: Run | null;
    /** Pending approvals that would change this note. */
    pending?: ApprovalItem[];
    onundone: () => void;
    /** Opens the change-by-change review for the run. */
    onreview?: () => void;
  } = $props();

  let asking = $state(false);
  let busy = $state(false);
  let error = $state("");

  async function confirm(): Promise<void> {
    if (!run) return;
    busy = true;
    error = "";
    try {
      await undoRun(run.id);
      asking = false;
      onundone();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not undo";
    } finally {
      busy = false;
    }
  }
</script>

{#if agentName || pending.length > 0}
  <div class="bar" role="region" aria-label="Agent activity on this note">
    {#if agentName}
      <span class="line">
        <span class="dot" aria-hidden="true"></span>
        <span class="text">Written by <strong>{agentName}</strong>{writtenAt ? `, ${relativeTime(writtenAt)}` : ""}</span>
        {#if run}<a class="act" href={`/runs/${encodeURIComponent(run.id)}`}>View run</a>{/if}
        {#if run && onreview}<button type="button" class="act" onclick={onreview}>Review changes</button>{/if}
        {#if run && !asking}
          <button type="button" class="act" onclick={() => ((asking = true), (error = ""))}>Undo this run</button>
        {:else if run}
          <span class="ask" role="alertdialog" aria-label="Confirm undo">
            Restore what this run changed?
            <button type="button" class="act danger" disabled={busy} onclick={() => void confirm()}>Undo</button>
            <button type="button" class="act" onclick={() => (asking = false)}>Keep</button>
          </span>
        {/if}
      </span>
    {/if}
    {#each pending as p (p.id)}
      <span class="line">
        <span class="dot" aria-hidden="true"></span>
        <span class="text"><strong>{p.agent ?? "An agent"}</strong> wants to change this note{p.stale ? " (it has changed since)" : ""}.</span>
        <a class="act" href="/approvals">Review</a>
      </span>
    {/each}
    {#if error}<span class="error" role="alert">{error}</span>{/if}
  </div>
{/if}

<style>
  .bar {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-6);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface-raised);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--amber);
  }

  .text strong {
    color: var(--ink);
    font-weight: 600;
  }

  .ask {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .act {
    padding: 2px var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    color: var(--ink);
    text-decoration: none;
    font-size: var(--text-label);
  }

  .act:hover {
    background: var(--surface-hover);
  }

  .act.danger {
    border-color: var(--err);
    color: var(--err-ink);
  }

  .error {
    color: var(--err-ink);
    font-family: var(--font-mono);
  }
</style>
