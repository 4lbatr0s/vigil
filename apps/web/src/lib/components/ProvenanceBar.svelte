<script lang="ts">
  import type { Run } from "@vigil/shared";
  import { ApiError, undoRun, type ApprovalItem } from "$lib/api";
  import { relativeTime } from "$lib/note-list";
  import { Button, Dialog } from "$lib/ui";

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
  <div class="bar" role="region" aria-label="Helper activity on this note">
    {#if agentName}
      <span class="line">
        <span class="dot" aria-hidden="true"></span>
        <span class="text">Written by <strong>{agentName}</strong>{writtenAt ? `, ${relativeTime(writtenAt)}` : ""}</span>
        {#if run}<Button variant="ghost" size="sm" href={`/runs/${encodeURIComponent(run.id)}`}>View run</Button>{/if}
        {#if run && onreview}<Button variant="ghost" size="sm" onclick={onreview}>Review changes</Button>{/if}
        {#if run}<Button variant="ghost" size="sm" onclick={() => ((asking = true), (error = ""))}>Undo this run</Button>{/if}
      </span>
    {/if}
    {#each pending as p (p.id)}
      <span class="line">
        <span class="dot" aria-hidden="true"></span>
        <span class="text"><strong>{p.agent ?? "A helper"}</strong> wants to change this note{p.stale ? " (it has changed since)" : ""}.</span>
        <Button variant="ghost" size="sm" href="/approvals">Review</Button>
      </span>
    {/each}
  </div>
{/if}

<Dialog bind:open={asking} title="Undo this run?" description="This restores what the run changed in this note.">
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (asking = false)}>Keep changes</Button>
    <Button variant="danger" disabled={busy} onclick={() => void confirm()}>Undo run</Button>
  {/snippet}
</Dialog>

<style>
  .bar {
    display: grid;
    gap: var(--s-1);
    margin: 0 var(--s-6);
    padding: var(--s-1) var(--s-3);
    border-radius: var(--r-control);
    background: var(--agent-fill);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--agent);
  }

  .text strong {
    color: var(--text);
    font-weight: var(--weight-strong);
  }

  .error {
    margin: 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  @media (max-width: 639px) {
    .bar {
      margin-inline: var(--s-4);
    }
  }
</style>
