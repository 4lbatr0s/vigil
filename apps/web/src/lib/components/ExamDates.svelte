<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getGoals, listNotes, removeGoal, setGoal, type Goal } from "$lib/api";
  import { goalLine } from "$lib/goals";
  import { Button, Field, Input, Select } from "$lib/ui";

  let { initialNote = null, onchange }: { initialNote?: string | null; onchange?: () => void } = $props();

  let goals = $state<Goal[]>([]);
  let noteIds = $state<{ id: string; title: string }[]>([]);
  let tagNames = $state<string[]>([]);
  let scope = $state<string>("");
  let day = $state("");
  let error = $state("");
  let adding = $state(false);

  const today = new Date();
  const minDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  onMount(async () => {
    try {
      const [g, notes] = await Promise.all([getGoals(), listNotes()]);
      goals = g;
      noteIds = notes.map((n) => ({ id: n.id, title: n.title }));
      tagNames = [...new Set(notes.flatMap((n) => n.tags))].sort();
      scope = initialNote ? `note:${initialNote}` : "";
      adding = initialNote !== null && g.length === 0;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load exam dates";
    }
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = "";
    const [kind, ...rest] = scope.split(":");
    const value = rest.join(":");
    if ((kind !== "note" && kind !== "tag") || value === "" || day === "") {
      error = "Pick a note or tag and a date.";
      return;
    }
    try {
      goals = await setGoal({ kind, value, day });
      adding = false;
      day = "";
      onchange?.();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    }
  }

  async function remove(g: Goal): Promise<void> {
    try {
      goals = await removeGoal(g.kind, g.value);
      onchange?.();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not remove";
    }
  }
</script>

<section class="exams" aria-labelledby="exam-dates">
  <h2 id="exam-dates">Exam dates</h2>
  {#if goals.length > 0}
    <ul>
      {#each goals as g (`${g.kind}:${g.value}`)}
        <li>
          <span>{goalLine(g)}</span>
          <Button variant="ghost" size="sm" aria-label={`Remove the exam date for ${g.value}`} onclick={() => void remove(g)}>Remove</Button>
        </li>
      {/each}
    </ul>
  {:else if !adding}
    <p class="muted">Set a date and Vigil paces your reviews to land before it.</p>
  {/if}
  {#if adding}
    <form onsubmit={save}>
      <Field label="What is it for">
        {#snippet children({ id })}
          <Select {id} bind:value={scope}>
            <option value="" disabled>Choose a note or tag</option>
            <optgroup label="Notes">
              {#each noteIds as n (n.id)}<option value={`note:${n.id}`}>{n.title}</option>{/each}
            </optgroup>
            {#if tagNames.length > 0}
              <optgroup label="Tags (every note with the tag)">
                {#each tagNames as t (t)}<option value={`tag:${t}`}>#{t}</option>{/each}
              </optgroup>
            {/if}
          </Select>
        {/snippet}
      </Field>
      <Field label="Date">
        {#snippet children({ id })}
          <Input {id} type="date" bind:value={day} min={minDay} />
        {/snippet}
      </Field>
      <span class="buttons">
        <Button variant="primary" type="submit">Save date</Button>
        <Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
      </span>
    </form>
  {:else}
    <Button onclick={() => (adding = true)}>Set an exam date</Button>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  h2 {
    margin: 0 0 var(--s-2);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  ul {
    margin: 0 0 var(--s-3);
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    gap: var(--s-3);
    justify-content: space-between;
    align-items: center;
    padding: var(--s-1) 0;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-3);
  }

  .buttons {
    display: inline-flex;
    gap: var(--s-2);
  }

  .muted {
    margin: 0 0 var(--s-3);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    margin: var(--s-2) 0 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
