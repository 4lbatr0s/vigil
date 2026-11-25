<script lang="ts">
  import { Badge, Button, Cluster, EmptyState, Kbd, Page, Row, Stack } from "$lib/ui";
  import { onMount } from "svelte";
  import { ApiError, decideApproval, listApprovals, type ApprovalItem } from "$lib/api";
  import { actionText } from "$lib/approval-text";
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

<Page title="Approvals">
  <Stack gap={4}>
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if !loaded}
      <p class="muted">Loading…</p>
    {:else if items.length === 0}
      <EmptyState title="Nothing is waiting for you. Agents in approval mode show up here before they write." />
    {:else}
      <div class="list" role="list" aria-label="Writes waiting for approval">
        {#each items as item (item.id)}
          {@const isNote = item.tool === "write_note" || item.tool === "append_note"}
          {@const lines = diffLines(item.currentBody, item.proposedBody)}
          {@const stats = diffStats(lines)}
          <div role="listitem">
            <Row
              title={isNote ? item.title || item.noteId : item.target}
              meta={agoText(item.createdAt)}
              snippet={`${item.agent ?? "agent"} · ${actionText(item)}`}
              selected={openId === item.id}
              onclick={() => (openId = openId === item.id ? null : item.id)}
            >
              {#snippet lead()}<span class="agent-dot" aria-hidden="true"></span>{/snippet}
              {#snippet trail()}{#if done[item.id]}<Badge>{done[item.id]?.text}</Badge>{/if}{/snippet}
            </Row>
            {#if done[item.id]?.runId}
              <p class="muted continues">Run continues. <a href={`/runs/${item.runId}`}>Open the run</a></p>
            {/if}
            {#if openId === item.id && !done[item.id]}
              <section class="review" aria-label={`Review ${isNote ? item.title : item.target}`}>
                {#if isNote}
                  {#if stale[item.id] || item.stale}
                    <p class="warn" role="status">This note changed after the agent proposed this write.</p>
                  {/if}
                  <p class="muted">+{stats.added} −{stats.removed}</p>
                  <pre class="diff" aria-label="Changes">{#each lines as l, i (i)}<span class={l.kind}>{l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}{l.text}
</span>{/each}</pre>
                {:else}
                  <p class="target">{item.target}</p>
                {/if}
                <Cluster gap={2}>
                  {#if stale[item.id] || item.stale}
                    <Button variant="danger" disabled={busy === item.id} onclick={() => void decide(item, "approve", true)}>Apply anyway</Button>
                  {:else}
                    <Button variant="primary" disabled={busy === item.id} onclick={() => void decide(item, "approve")}>Approve <Kbd keys="A" /></Button>
                  {/if}
                  <Button variant="ghost" disabled={busy === item.id} onclick={() => void decide(item, "reject")}>Reject <Kbd keys="R" /></Button>
                </Cluster>
                {#if stale[item.id] || item.stale}<p class="muted">Apply anyway saves the current text first, so Undo on the run can bring it back.</p>{/if}
              </section>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </Stack>
</Page>

<style>
  p {
    margin: 0;
  }

  .muted {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  .agent-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-top: var(--s-1);
    border-radius: var(--r-pill);
    background: var(--agent);
  }

  .continues {
    padding: 0 var(--s-3) var(--s-3);
  }

  .review {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3) var(--s-5);
  }

  .warn {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    background: var(--agent-fill);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .target {
    margin: 0;
    overflow-wrap: anywhere;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-body-lh) var(--font-code);
  }

  .diff {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-body-lh) var(--font-code);
    max-height: 50vh;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .diff .add {
    display: block;
    color: var(--good);
  }

  .diff .del {
    display: block;
    color: var(--danger);
  }

  .diff .same {
    display: block;
    color: var(--text-3);
  }
</style>
