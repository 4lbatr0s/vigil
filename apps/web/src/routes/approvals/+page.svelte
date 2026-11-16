<script lang="ts">
  import Illustration from "$lib/components/Illustration.svelte";
  import { onMount } from "svelte";
  import { ApiError, decideApproval, listApprovals, type ApprovalItem } from "$lib/api";
  import { diffLines, diffStats } from "$lib/diff";
  import { agoText } from "$lib/format";
  import { refreshOnLive } from "$lib/live";
  import { refreshPending } from "$lib/approvals-state";

  let items = $state<ApprovalItem[]>([]);
  let loaded = $state(false);
  let error = $state("");
  let openId = $state<string | null>(null);
  let busy = $state<string | null>(null);
  /** Per approval: the server said the note changed; show Apply anyway. */
  let stale = $state<Record<string, boolean>>({});
  let done = $state<Record<string, { text: string; runId: string | null }>>({});

  async function load(): Promise<void> {
    try {
      items = await listApprovals("pending");
      error = "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load approvals";
    } finally {
      loaded = true;
    }
  }

  onMount(() => refreshOnLive(load, ["approval"], 5000));

  async function decide(item: ApprovalItem, decision: "approve" | "reject", force = false): Promise<void> {
    busy = item.id;
    error = "";
    try {
      const result = await decideApproval(item.id, decision, force);
      done[item.id] = { text: decision === "approve" ? "Approved" : "Rejected", runId: result.runResumed ? item.runId : null };
      delete stale[item.id];
      openId = null;
      void refreshPending();
      // The row shows its result for a moment, then leaves.
      setTimeout(() => {
        items = items.filter((i) => i.id !== item.id);
        delete done[item.id];
      }, 3000);
    } catch (err) {
      if (err instanceof ApiError && err.code === "approval-stale") {
        stale[item.id] = true;
        await load(); // the diff now shows the note as it is
        openId = item.id;
      } else {
        error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save the decision";
      }
    } finally {
      busy = null;
    }
  }

  /** A approves and R rejects the open review; ignored while typing in a field or holding a modifier. */
  function onWindowKey(event: KeyboardEvent): void {
    const target = event.target;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const item = items.find((i) => i.id === openId);
    if (!item || busy || done[item.id]) return;
    if (event.key.toLowerCase() === "a" && !stale[item.id] && !item.stale) void decide(item, "approve");
    if (event.key.toLowerCase() === "r") void decide(item, "reject");
  }
</script>

<svelte:head><title>Approvals · Vigil</title></svelte:head>
<svelte:window onkeydown={onWindowKey} />

<main class="page">
  <h1>Approvals</h1>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else if items.length === 0}
    <section class="empty">
      <Illustration kind="calm" />
      <p class="empty-title">All caught up. Nothing is waiting for you.</p>
      <p class="muted">Agents in approval mode will appear here before they write.</p>
    </section>
  {:else}
    <ul class="ledger" aria-label="Writes waiting for approval">
      {#each items as item (item.id)}
        {@const lines = diffLines(item.currentBody, item.proposedBody)}
        {@const stats = diffStats(lines)}
        <li>
          <button type="button" class="row" aria-expanded={openId === item.id} onclick={() => (openId = openId === item.id ? null : item.id)}>
            <span class="stamp">{agoText(item.createdAt)}</span>
            <span class="title">{item.title || item.noteId}</span>
            <span class="meta">{item.agent ?? "agent"} · {item.currentBody === null ? "creates" : "replaces"}</span>
            {#if done[item.id]}<span class="result">{done[item.id]?.text}</span>{/if}
          </button>
          {#if done[item.id]?.runId}
            <p class="muted continues">Run continues. <a href={`/runs/${item.runId}`}>Open the run</a></p>
          {/if}
          {#if openId === item.id && !done[item.id]}
            <section class="review" aria-label={`Review ${item.title}`}>
              {#if stale[item.id] || item.stale}
                <p class="warn" role="status">This note changed after the agent proposed this write.</p>
              {/if}
              <p class="muted stats">+{stats.added} −{stats.removed}</p>
              <pre class="diff" aria-label="Changes">{#each lines as l, i (i)}<span class={l.kind}>{l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}{l.text}
</span>{/each}</pre>
              <div class="actions">
                {#if stale[item.id] || item.stale}
                  <button type="button" class="danger" disabled={busy === item.id} onclick={() => void decide(item, "approve", true)}>Apply anyway</button>
                {:else}
                  <button type="button" class="primary" disabled={busy === item.id} onclick={() => void decide(item, "approve")}>Approve</button>
                {/if}
                <button type="button" class="ghost" disabled={busy === item.id} onclick={() => void decide(item, "reject")}>Reject</button>
                <span class="muted keys">A approve · R reject</span>
              </div>
              {#if stale[item.id] || item.stale}<p class="muted">Apply anyway saves the current text first, so Undo on the run can bring it back.</p>{/if}
            </section>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 960px;
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
    margin-bottom: var(--space-4);
  }
  .muted {
    color: var(--ink-muted);
  }
  .error {
    color: var(--err-ink);
    margin-bottom: var(--space-3);
  }
  .empty {
    padding: var(--space-12) 0;
    text-align: center;
  }
  .empty-title {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    margin-bottom: var(--space-2);
  }
  .ledger {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--hairline);
  }
  .ledger > li {
    border-bottom: 1px solid var(--hairline);
  }
  .row {
    display: grid;
    grid-template-columns: 110px 1fr 220px auto;
    gap: var(--space-3);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) var(--space-2);
    text-align: left;
  }
  .row:hover {
    background: var(--surface);
  }
  .stamp,
  .meta,
  .result {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
  }
  .continues {
    padding: 0 var(--space-2) var(--space-3);
    font-size: var(--text-label);
  }
  .review {
    padding: var(--space-2) var(--space-2) var(--space-4);
  }
  .warn {
    border: 1px solid var(--amber);
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
    font-size: var(--text-label);
  }
  .stats {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    margin-bottom: var(--space-1);
  }
  .diff {
    margin: 0 0 var(--space-3);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    line-height: 1.5;
    max-height: 50vh;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .diff .add {
    color: var(--ok);
    display: block;
  }
  .diff .del {
    color: var(--err-ink);
    display: block;
  }
  .diff .same {
    color: var(--ink-muted);
    display: block;
  }
  .actions {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .primary,
  .ghost,
  .danger {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    font-size: var(--text-label);
  }
  .primary {
    background: var(--ink);
    color: var(--bg);
  }
  .ghost {
    border-color: var(--hairline);
    background: var(--surface);
  }
  .danger {
    border-color: var(--err);
    color: var(--err-ink);
  }
  button:disabled {
    opacity: 0.5;
  }
  .keys {
    font-size: var(--text-label);
  }
  @media (max-width: 800px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
