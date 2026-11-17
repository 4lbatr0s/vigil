<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getGoals, listNotes, removeGoal, setGoal, type Goal } from "$lib/api";
  import { goalLine } from "$lib/goals";

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
          <button type="button" class="linkbtn" aria-label={`Remove the exam date for ${g.value}`} onclick={() => void remove(g)}>Remove</button>
        </li>
      {/each}
    </ul>
  {:else if !adding}
    <p class="muted">Have a test coming? Set a date and Vigil will pace your reviews so they land before it.</p>
  {/if}
  {#if adding}
    <form onsubmit={save}>
      <label>
        <span class="muted">What is it for</span>
        <select bind:value={scope}>
          <option value="" disabled>Choose a note or tag</option>
          <optgroup label="Notes">
            {#each noteIds as n (n.id)}<option value={`note:${n.id}`}>{n.title}</option>{/each}
          </optgroup>
          {#if tagNames.length > 0}
            <optgroup label="Tags (every note with the tag)">
              {#each tagNames as t (t)}<option value={`tag:${t}`}>#{t}</option>{/each}
            </optgroup>
          {/if}
        </select>
      </label>
      <label>
        <span class="muted">Date</span>
        <input type="date" bind:value={day} min={minDay} />
      </label>
      <button type="submit" class="btn primary">Save</button>
      <button type="button" class="btn" onclick={() => (adding = false)}>Cancel</button>
    </form>
  {:else}
    <button type="button" class="btn" onclick={() => (adding = true)}>Set an exam date</button>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .exams h2 {
    margin-bottom: var(--space-2);
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    font-weight: 500;
    color: var(--ink-muted);
  }
  ul {
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-3);
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  select,
  input {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-ui);
    cursor: pointer;
  }
  .btn:hover {
    background: var(--surface-hover);
  }
  .btn.primary {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  .linkbtn {
    border: 0;
    background: transparent;
    color: var(--ink-muted);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    font-size: var(--text-label);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .error {
    color: var(--err-ink);
  }
</style>
