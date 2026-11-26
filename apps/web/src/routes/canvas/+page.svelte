<script lang="ts">
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import { Button, Cluster, Dialog, EmptyState, IconButton, Input, Menu, Page, Row, Stack, ViewSwitch } from "$lib/ui";
  import { NOTE_VIEWS } from "$lib/links";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { ApiError, createCanvas, deleteCanvas, getCanvas, listCanvases, saveCanvas, type CanvasSummary } from "$lib/api";
  import { starterBoard } from "$lib/canvas-layout";
  import { relativeTime } from "$lib/note-list";

  let canvases = $state<CanvasSummary[] | null>(null);
  let title = $state("");
  let error = $state("");
  let busy = $state(false);
  let confirmDelete = $state<string | null>(null);
  let deleteOpen = $state(false);

  async function load(): Promise<void> {
    try {
      canvases = await listCanvases();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load canvases";
    }
  }
  onMount(() => void load());

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || title.trim() === "") return;
    busy = true;
    error = "";
    try {
      const c = await createCanvas(title.trim());
      await goto(`/canvas/${encodeURIComponent(c.id)}`);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not create it";
    } finally {
      busy = false;
    }
  }

  /** A board that already has a few cards on it: a path of steps with checklists, or a topic with branches. */
  async function startFrom(kind: "path" | "mindmap"): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const c = await createCanvas(title.trim() || (kind === "path" ? "Learning path" : "Mind map"));
      await saveCanvas(c.id, starterBoard(kind), c.updatedAt);
      await goto(`/canvas/${encodeURIComponent(c.id)}`);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not create it";
    } finally {
      busy = false;
    }
  }

  /** A copy of a board under a new name; the cards are copied, the notes they show are not. */
  async function duplicate(id: string): Promise<void> {
    error = "";
    try {
      const from = await getCanvas(id);
      const made = await createCanvas(`${id} copy`);
      await saveCanvas(made.id, from.canvas, made.updatedAt);
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not copy it";
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteCanvas(id);
      confirmDelete = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : "Could not delete it";
    }
  }
</script>

<svelte:head><title>Boards · Vigil</title></svelte:head>

<Page title="Boards">
  {#snippet actions()}<ViewSwitch label="Ways to see your notes" items={NOTE_VIEWS} current="/canvas" />{/snippet}
  <Stack gap={6}>
    <p class="muted">Place notes and your own text anywhere, and draw arrows between them.</p>
    <form onsubmit={create}>
      <Input bind:value={title} placeholder="Name a new board, for example Exam plan" aria-label="Name of the new board" maxlength={100} />
      <Button variant="primary" type="submit" disabled={busy || title.trim() === ""}>New board</Button>
    </form>
    <Cluster gap={2}>
      <span class="muted">Or start from</span>
      <Button variant="ghost" size="sm" disabled={busy} onclick={() => void startFrom("path")}>A learning path</Button>
      <Button variant="ghost" size="sm" disabled={busy} onclick={() => void startFrom("mindmap")}>A mind map</Button>
    </Cluster>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if canvases === null}
      <p class="muted">Loading…</p>
    {:else if canvases.length === 0}
      <EmptyState title="No boards yet. Name one above to start." />
    {:else}
      <div class="list" role="list">
        {#each canvases as c (c.id)}
          <div class="item" role="listitem">
            <Row title={c.id} meta={relativeTime(c.updatedAt)} snippet={`${c.nodes} ${c.nodes === 1 ? "card" : "cards"}`} href={`/canvas/${encodeURIComponent(c.id)}`} />
            <span class="more">
              <Menu
                label={`More actions for ${c.id}`}
                items={[
                  { label: "Duplicate", onselect: () => void duplicate(c.id) },
                  { kind: "separator" },
                  { label: "Delete", danger: true, onselect: () => ((confirmDelete = c.id), (deleteOpen = true)) },
                ]}
              >
                {#snippet trigger({ props })}
                  <IconButton size="sm" label={`More actions for ${c.id}`} {...props}><Ellipsis size={14} strokeWidth={1.5} /></IconButton>
                {/snippet}
              </Menu>
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </Stack>
</Page>

<Dialog bind:open={deleteOpen} title="Delete this board?" description="Your notes stay; only the board is removed.">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (deleteOpen = false)}>Keep it</Button>
    <Button variant="danger" onclick={() => { const id = confirmDelete; deleteOpen = false; if (id) void remove(id); }}>Delete board</Button>
  {/snippet}
</Dialog>

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

  code {
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-code);
  }

  form {
    display: flex;
    gap: var(--s-2);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }

  .item {
    position: relative;
  }

  .more {
    position: absolute;
    right: var(--s-2);
    bottom: var(--s-2);
    display: none;
  }

  .item:hover .more,
  .item:focus-within .more {
    display: inline-flex;
  }
</style>
