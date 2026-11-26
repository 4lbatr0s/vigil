<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getStudySettings, putStudySettings, type StudySettings } from "$lib/api";
  import { Field, Input, Select } from "$lib/ui";

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
    <h2 id="study-settings">Cards and reviews</h2>
    <p class="muted">How many new cards you meet each day, and how sure the scheduler aims to keep you of what you have learned. Higher means more reviews for the same cards.</p>
    <div class="fields">
      <Field label="New cards per day">
        {#snippet children({ id })}
          <span class="narrow"><Input {id} type="number" min="0" max="50" step="1" value={String(settings!.newPerDay)} onchange={(e) => void save({ ...settings!, newPerDay: Math.min(50, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))) })} /></span>
        {/snippet}
      </Field>
      <Field label="Remembering target">
        {#snippet children({ id })}
          <Select {id} value={String(settings!.retention)} onchange={(e) => void save({ ...settings!, retention: Number(e.currentTarget.value) })}>
            {#each LEVELS as l (l.value)}<option value={String(l.value)}>{l.label}</option>{/each}
          </Select>
        {/snippet}
      </Field>
    </div>
    <p class="muted" aria-live="polite">{notice}</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4);
    margin: var(--s-3) 0;
  }

  .fields :global(select) {
    min-width: 18rem;
  }

  .narrow {
    display: inline-block;
    width: 6rem;
  }

  .muted {
    margin: 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    margin: 0;
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
