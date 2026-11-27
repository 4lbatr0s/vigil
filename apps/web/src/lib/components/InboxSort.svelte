<script lang="ts">
  /**
   * The inbox on Today (2026-11-26): each captured thought with three ways out. Make a note of it, add it to a note,
   * or delete it (N, A, D while a line has focus). Every write sends the base time, so a capture that lands in
   * between is never overwritten; the page reloads the inbox and tries nothing twice.
   */
  import type { Snippet } from "svelte";
  import Trash from "@lucide/svelte/icons/trash-2";
  import type { Note } from "@vigil/shared";
  import { ApiError, getNote, putNote } from "$lib/api";
  import { rank } from "$lib/fuzzy";
  import { appendLine, inboxLines, noteFromLine, withoutLine, type InboxLine } from "$lib/inbox";
  import { noteHref } from "$lib/links";
  import { Button, Dialog, IconButton, Input, Row } from "$lib/ui";

  const INBOX_ID = "inbox";
  const SHOW = 7;

  let {
    notes,
    version = 0,
    onchange,
    actions,
  }: {
    /** Notes a line can be added to. */
    notes: { id: string; title: string }[];
    /** Bump it to reload the inbox (after a capture). */
    version?: number;
    onchange?: () => void;
    /** Extra controls beside the heading. */
    actions?: Snippet;
  } = $props();

  let inbox = $state<Note | null>(null);
  let busy = $state(false);
  let message = $state("");
  let made = $state<{ id: string; title: string } | null>(null);
  let undoBody = $state<string | null>(null);
  let sorted = $state(0);
  let pickFor = $state<InboxLine | null>(null);
  let pickOpen = $state(false);
  let query = $state("");

  const lines = $derived(inbox ? inboxLines(inbox.body) : []);
  const shown = $derived(lines.slice(0, SHOW));
  const choices = $derived(rank(notes.filter((n) => n.id !== INBOX_ID), query, (n) => n.title).slice(0, 8));

  async function load(): Promise<void> {
    try {
      inbox = await getNote(INBOX_ID);
    } catch (err) {
      // No inbox note yet is the normal empty case; anything else is worth saying.
      if (!(err instanceof ApiError && err.code === "note-not-found")) message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not load the inbox";
      inbox = null;
    }
  }

  $effect(() => {
    void version;
    void load();
  });

  /** Reloads the inbox, finds the same line again by its text, and runs `step` with the fresh note. */
  async function act(l: InboxLine, step: (fresh: Note, at: InboxLine) => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    message = "";
    made = null;
    undoBody = null;
    try {
      const fresh = await getNote(INBOX_ID);
      const at = inboxLines(fresh.body).find((x) => x.text === l.text);
      if (!at) {
        message = "That line is no longer in the inbox.";
      } else {
        await step(fresh, at);
        sorted += 1;
        onchange?.();
      }
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not sort that line";
    } finally {
      await load();
      busy = false;
    }
  }

  async function saveInbox(fresh: Note, body: string): Promise<void> {
    inbox = await putNote(INBOX_ID, { title: fresh.title, body, baseUpdatedAt: fresh.updatedAt });
  }

  async function addToNote(id: string, text: string): Promise<Note> {
    const target = await getNote(id);
    return putNote(id, { title: target.title, body: appendLine(target.body, text), baseUpdatedAt: target.updatedAt });
  }

  function makeNote(l: InboxLine): Promise<void> {
    return act(l, async (fresh, at) => {
      const next = noteFromLine(at.text);
      const note = notes.some((n) => n.id === next.id) ? await addToNote(next.id, at.text) : await putNote(next.id, { title: next.title, body: next.body });
      await saveInbox(fresh, withoutLine(fresh.body, at.line));
      made = { id: note.id, title: note.title };
      message = notes.some((n) => n.id === next.id) ? `Added to “${note.title}”.` : `Made a note: “${note.title}”.`;
    });
  }

  function openPick(l: InboxLine): void {
    pickFor = l;
    query = "";
    pickOpen = true;
  }

  function addTo(target: { id: string; title: string }): Promise<void> {
    const l = pickFor;
    pickOpen = false;
    if (!l) return Promise.resolve();
    return act(l, async (fresh, at) => {
      await addToNote(target.id, at.text);
      await saveInbox(fresh, withoutLine(fresh.body, at.line));
      made = target;
      message = `Added to “${target.title}”.`;
    });
  }

  function remove(l: InboxLine): Promise<void> {
    return act(l, async (fresh, at) => {
      await saveInbox(fresh, withoutLine(fresh.body, at.line));
      undoBody = fresh.body;
      message = "Deleted.";
    });
  }

  async function undoDelete(): Promise<void> {
    const body = undoBody;
    if (body === null || !inbox || busy) return;
    busy = true;
    try {
      await saveInbox(inbox, body);
      sorted = Math.max(0, sorted - 1);
      message = "Put back.";
      undoBody = null;
      onchange?.();
    } catch (err) {
      message = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not put it back";
    } finally {
      busy = false;
    }
  }

  function onKey(event: KeyboardEvent, l: InboxLine): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "n") void makeNote(l);
    else if (key === "a") openPick(l);
    else if (key === "d") void remove(l);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

{#if lines.length > 0 || sorted > 0}
  <section class="inbox" aria-labelledby="inbox-head">
    <div class="head">
      <h2 id="inbox-head">Inbox{#if lines.length > 0}<span class="count">{lines.length}</span>{/if}</h2>
      {#if lines.length > 0 && actions}{@render actions()}{/if}
    </div>
    {#if lines.length === 0}
      <p class="muted">Your inbox is empty. Everything has a place.</p>
    {:else}
      <ul>
        {#each shown as l (l.line)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li onkeydown={(e) => onKey(e, l)}>
            <span class="text">{l.text}</span>
            <span class="acts">
              <Button variant="ghost" size="sm" disabled={busy} onclick={() => void makeNote(l)}>Make a note</Button>
              <Button variant="ghost" size="sm" disabled={busy} onclick={() => openPick(l)}>Add to a note</Button>
              <IconButton size="sm" label={`Delete “${l.text}”`} shortcut="D" disabled={busy} onclick={() => void remove(l)}><Trash size={14} strokeWidth={1.5} /></IconButton>
            </span>
          </li>
        {/each}
      </ul>
      {#if lines.length > shown.length}<p class="muted"><a href={noteHref(INBOX_ID)}>{lines.length - shown.length} more in the Inbox note</a></p>{/if}
    {/if}
    <div aria-live="polite">
      {#if message}
        <p class="status">
          {message}
          {#if made}<a href={noteHref(made.id)}>Open it</a>{/if}
          {#if undoBody !== null}<Button variant="ghost" size="sm" onclick={() => void undoDelete()}>Undo</Button>{/if}
        </p>
      {/if}
    </div>
  </section>
{/if}

<Dialog bind:open={pickOpen} title="Add to a note" description={pickFor ? pickFor.text : ""}>
  <!-- svelte-ignore a11y_autofocus -->
  <Input bind:value={query} type="search" aria-label="Find a note" placeholder="Find a note" autofocus />
  <div class="choices">
    {#each choices as n (n.id)}
      <Row title={n.title} onclick={() => void addTo(n)} />
    {:else}
      <p class="muted">No note matches.</p>
    {/each}
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (pickOpen = false)}>Cancel</Button>
  {/snippet}
</Dialog>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-2);
  }

  h2 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-prose);
  }

  .count {
    margin-left: var(--s-2);
    color: var(--text-3);
    font: var(--weight-regular) var(--type-ui-size) / 1 var(--font-ui);
  }

  ul {
    list-style: none;
    margin: 0 calc(var(--s-3) * -1);
    padding: 0;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-1) var(--s-3);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
  }

  li:hover,
  li:focus-within {
    background: var(--fill-hover);
  }

  .text {
    flex: 1 1 16ch;
    min-width: 0;
    color: var(--text);
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-prose);
    overflow-wrap: anywhere;
  }

  .acts {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }

  /* With a mouse on a wide screen the actions wait until a line is pointed at or focused; on touch or a narrow
     screen, where they wrap under the line, they are always there. */
  @media (pointer: fine) and (min-width: 640px) {
    .acts {
      opacity: 0;
      transition: opacity var(--dur-fast) var(--ease-out);
    }
    li:hover .acts,
    li:focus-within .acts {
      opacity: 1;
    }
  }

  .muted {
    margin: var(--s-1) 0 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .muted a,
  .status a {
    color: var(--text-2);
    text-underline-offset: 2px;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--control-h);
    margin: var(--s-1) 0 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .choices {
    display: grid;
    margin: var(--s-3) calc(var(--s-3) * -1) 0;
    max-height: 50vh;
    overflow-y: auto;
  }
</style>
