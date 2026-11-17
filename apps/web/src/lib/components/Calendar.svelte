<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { monthGrid, monthLabel, shiftMonth } from "$lib/calendar";
  import { dailyNote } from "$lib/daily";

  let {
    noteDays = new Set<string>(),
    studyDays = new Set<string>(),
    selectedDay = null,
    onpick,
  }: {
    /** Days (`2026-11-17`) that already have a daily note. */
    noteDays?: Set<string>;
    /** Days on which cards were answered. */
    studyDays?: Set<string>;
    selectedDay?: string | null;
    onpick: (day: string) => void;
  } = $props();

  const start = new Date();
  let year = $state(start.getFullYear());
  let month = $state(start.getMonth());
  const today = $derived(dailyNote().id);
  const weeks = $derived(monthGrid(year, month));
  const weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  function go(delta: number): void {
    ({ year, month } = shiftMonth(year, month, delta));
  }
  function jumpToday(): void {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
    onpick(dailyNote(now).id);
  }
  function describe(day: string): string {
    const parts = [day];
    if (noteDays.has(day)) parts.push("has a note");
    if (studyDays.has(day)) parts.push("you studied");
    return parts.join(", ");
  }
</script>

<div class="cal">
  <div class="bar">
    <button type="button" class="nav" aria-label="Previous month" onclick={() => go(-1)}><ChevronLeft size={14} strokeWidth={1.5} /></button>
    <span class="label" aria-live="polite">{monthLabel(year, month)}</span>
    <button type="button" class="nav" aria-label="Next month" onclick={() => go(1)}><ChevronRight size={14} strokeWidth={1.5} /></button>
    <button type="button" class="todaybtn" onclick={jumpToday}>Today</button>
  </div>
  <div class="grid" role="grid" aria-label={monthLabel(year, month)}>
    <div class="row head" role="row">
      {#each weekdays as w (w)}<span role="columnheader">{w}</span>{/each}
    </div>
    {#each weeks as week, i (i)}
      <div class="row" role="row">
        {#each week as c (c.day)}
          <button
            type="button"
            role="gridcell"
            class="day"
            class:out={!c.inMonth}
            class:today={c.day === today}
            class:selected={c.day === selectedDay}
            class:has={noteDays.has(c.day)}
            class:studied={studyDays.has(c.day)}
            aria-label={describe(c.day)}
            aria-current={c.day === today ? "date" : undefined}
            onclick={() => onpick(c.day)}
          >{c.date}</button>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .cal {
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-label);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .label {
    flex: 1;
    text-align: center;
    color: var(--ink);
    font-weight: 500;
  }
  .nav,
  .todaybtn {
    border: 0;
    background: transparent;
    color: var(--ink-muted);
    border-radius: var(--radius);
    padding: var(--space-1);
    cursor: pointer;
    font: inherit;
    display: inline-flex;
    align-items: center;
  }
  .nav:hover,
  .todaybtn:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .head span {
    text-align: center;
    color: var(--ink-muted);
    padding: var(--space-1) 0;
  }
  .day {
    position: relative;
    aspect-ratio: 1;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .day:hover {
    background: var(--surface-hover);
  }
  .day.out {
    color: var(--ink-muted);
  }
  .day.today {
    font-weight: 700;
    outline: 1px solid var(--ink-muted);
    outline-offset: -1px;
  }
  .day.selected {
    background: var(--surface-hover);
  }
  /* A note that exists is a small dot; a study day is a thin underline. Neither uses amber (agent life only). */
  .day.has::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--ink-muted);
  }
  .day.studied {
    box-shadow: inset 0 -2px 0 var(--ok);
  }
  .nav:focus-visible,
  .todaybtn:focus-visible,
  .day:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
</style>
