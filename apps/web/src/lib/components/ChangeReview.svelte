<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getBodyBeforeRun, getNote, putNote } from "$lib/api";
  import { diffLines, revertChange, segments, type Segment } from "$lib/diff";

  let { runId, noteId, agentName, onclose, onchanged }: { runId: string; noteId: string; agentName: string; onclose: () => void; onchanged: () => void } = $props();

  let before = $state<string | null>(null);
  let existed = $state(true);
  let after = $state("");
  let loading = $state(true);
  let busy = $state(false);
  let error = $state("");
  let reverted = $state(0);

  const parts = $derived<Segment[]>(before === null ? [] : segments(diffLines(before, after)));
  const changes = $derived(parts.filter((p) => p.kind === "change"));

  async function load(): Promise<void> {
    try {
      const [b, note] = await Promise.all([getBodyBeforeRun(runId, noteId), getNote(noteId)]);
      existed = b.existed;
      before = b.body;
      after = note.body;
      error = "";
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not load the changes";
    } finally {
      loading = false;
    }
  }
  onMount(() => void load());

  async function revert(id: number): Promise<void> {
    if (before === null || busy) return;
    busy = true;
    error = "";
    try {
      // From the newest saved text, so an edit made meanwhile is not overwritten.
      const note = await getNote(noteId);
      const next = revertChange(before, note.body, id);
      await putNote(noteId, { title: note.title, body: next, baseUpdatedAt: note.updatedAt });
      reverted += 1;
      await load();
      onchanged();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not revert that change";
    } finally {
      busy = false;
    }
  }

  /** One line of context on each side of a change keeps it readable without the whole note. */
  function context(index: number): { head: string | undefined; tail: string | undefined } {
    const prev = parts[index - 1];
    const next = parts[index + 1];
    return { head: prev?.kind === "same" ? prev.lines.at(-1) : undefined, tail: next?.kind === "same" ? next.lines[0] : undefined };
  }
</script>

<section class="review" aria-label={`Changes ${agentName} made`}>
  <div class="top">
    <strong>Changes {agentName} made</strong>
    <button type="button" class="act" onclick={onclose}>Done</button>
  </div>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error && before === null}
    <p class="error" role="alert">{error}</p>
  {:else if !existed}
    <p class="muted">{agentName} created this note, so there is nothing earlier to compare with. To remove it, use “Undo this run”.</p>
  {:else if changes.length === 0}
    <p class="muted">Nothing left to review{reverted > 0 ? `: you reverted ${reverted} ${reverted === 1 ? "change" : "changes"}` : ""}. The text now matches what it was before the run.</p>
  {:else}
    <p class="muted">Each change is shown with the line around it. Keep it by leaving it alone, or put the old text back.</p>
    <ol>
      {#each parts as p, i (i)}
        {#if p.kind === "change"}
          {@const ctx = context(i)}
          <li>
            <div class="diff" role="group" aria-label={`Change ${p.id + 1} of ${changes.length}`}>
              {#if ctx.head !== undefined}<div class="line same">{ctx.head}</div>{/if}
              {#each p.del as l, k (k)}<div class="line del"><span aria-hidden="true">−</span> {l}</div>{/each}
              {#each p.add as l, k (k)}<div class="line add"><span aria-hidden="true">+</span> {l}</div>{/each}
              {#if ctx.tail !== undefined}<div class="line same">{ctx.tail}</div>{/if}
            </div>
            <button type="button" class="act" disabled={busy} onclick={() => void revert(p.id)}>Put the old text back</button>
          </li>
        {/if}
      {/each}
    </ol>
  {/if}
  {#if error && before !== null}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .review {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface-raised);
    font-size: var(--text-label);
    max-height: 40vh;
    overflow: auto;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-3);
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-start;
    justify-content: space-between;
  }
  .diff {
    flex: 1 1 320px;
    min-width: 0;
    font-family: var(--font-mono);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .line {
    padding: 2px var(--space-3);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--ink-muted);
  }
  .line.add {
    color: var(--ink);
    border-left: 3px solid var(--amber);
  }
  .line.del {
    color: var(--ink-muted);
    text-decoration: line-through;
    border-left: 3px solid var(--hairline);
  }
  .act {
    padding: 2px var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .act:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .act:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .muted {
    margin: 0;
    color: var(--ink-muted);
  }
  .error {
    margin: 0;
    color: var(--err-ink);
  }
</style>
