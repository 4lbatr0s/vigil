<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getStudySettings, putStudySettings, type StudySettings } from "$lib/api";

  const LEVELS = [
    { value: 0.8, label: "Relaxed (80%): fewest reviews, you will forget more" },
    { value: 0.85, label: "Balanced (85%)" },
    { value: 0.9, label: "Standard (90%): a common starting point" },
    { value: 0.95, label: "Thorough (95%): remember more, many more reviews" },
  ];

  let settings = $state<StudySettings | null>(null);
  let notice = $state("");
  let error = $state("");

  onMount(async () => {
    try {
      settings = await getStudySettings();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load study settings";
    }
  });

  async function save(next: StudySettings): Promise<void> {
    error = "";
    notice = "";
    try {
      settings = await putStudySettings(next);
      notice = "Saved.";
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    }
  }
</script>

{#if settings}
  <section aria-labelledby="study-settings">
    <h2 id="study-settings">Study</h2>
    <p class="muted">How many new cards you meet each day, and how sure the scheduler should aim to keep you of what you have learned. Higher means more reviews for the same cards; the best balance differs from person to person.</p>
    <div class="fields">
      <label>
        <span>New cards per day</span>
        <input type="number" min="0" max="50" step="1" value={settings.newPerDay} onchange={(e) => void save({ ...settings!, newPerDay: Math.min(50, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))) })} />
      </label>
      <label>
        <span>Remembering target</span>
        <select value={settings.retention} onchange={(e) => void save({ ...settings!, retention: Number(e.currentTarget.value) })}>
          {#each LEVELS as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
        </select>
      </label>
    </div>
    <p class="muted" aria-live="polite">{notice}</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  input,
  select {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .error {
    color: var(--err-ink);
  }
</style>
