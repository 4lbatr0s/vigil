<script lang="ts">
  import { slugify, type Note } from "@vigil/shared";
  import { ApiError, planRenameNote, renameNote, type RenamePlan } from "$lib/api";
  import { Button, Dialog, Field, Input } from "$lib/ui";

  let { noteId, title, open = $bindable(false), onrenamed }: { noteId: string; title: string; open?: boolean; onrenamed: (note: Note) => void } = $props();

  let draft = $state("");
  let plan = $state<RenamePlan | null>(null);
  let error = $state("");
  let busy = $state(false);

  const newId = $derived(slugify(draft.trim()));

  // Each time the dialog opens it starts from the current title.
  $effect(() => {
    if (open) {
      draft = title;
      plan = null;
      error = "";
    }
  });

  async function check(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (plan) return void confirm();
    error = "";
    busy = true;
    try {
      plan = await planRenameNote(noteId, draft);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not check the rename";
    } finally {
      busy = false;
    }
  }

  async function confirm(): Promise<void> {
    busy = true;
    error = "";
    try {
      const note = await renameNote(noteId, draft);
      open = false;
      onrenamed(note);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not rename the note";
    } finally {
      busy = false;
    }
  }

  const hint = $derived(
    plan
      ? plan.notesToChange.length === 0
        ? "No other note links here."
        : `This updates links in ${plan.notesToChange.length} ${plan.notesToChange.length === 1 ? "note" : "notes"}: ${plan.titles.join(", ")}.`
      : `The file name follows the title: ${newId || "…"}.md`,
  );
</script>

<Dialog bind:open title="Rename note">
  <form id="rename-form" onsubmit={(e) => void check(e)}>
    <Field label="New title" {hint} error={error || undefined}>
      {#snippet children({ id, describedby, invalid })}
        <Input {id} aria-describedby={describedby} {invalid} bind:value={draft} oninput={() => (plan = null)} />
      {/snippet}
    </Field>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="rename-form" disabled={busy || draft.trim() === ""}>{plan ? "Rename note" : "Check links"}</Button>
  {/snippet}
</Dialog>
