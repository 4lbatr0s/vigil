<script lang="ts">
  /** Small line drawings for empty states. Strokes use text colors only; amber appears only where an agent is the subject. */
  let { kind, size = 96 }: { kind: "page" | "lantern" | "calm" | "cards"; size?: number } = $props();
</script>

<svg class="ill" width={size} height={size} viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true">
  {#if kind === "page"}
    <!-- a blank page with a pen resting on it -->
    <rect x="22" y="14" width="46" height="62" rx="6" />
    <path d="M32 30h26M32 40h26M32 50h14" opacity="0.55" />
    <path d="M70 58l12-12 6 6-12 12-8 2z" />
    <path d="M78 50l6 6" />
  {:else if kind === "lantern"}
    <!-- a small lantern: the agent's light -->
    <path d="M48 10v8" />
    <path d="M38 22h20l4 6H34z" />
    <rect x="34" y="28" width="28" height="34" rx="7" />
    <path d="M40 66h16l-3 10H43z" />
    <path class="flame" d="M48 38c5 5 6 9 0 15-6-6-5-10 0-15z" />
    <path d="M30 40h-6M72 40h-6M28 52h-6" opacity="0.4" />
  {:else if kind === "calm"}
    <!-- a quiet circle with a check, for "all caught up" -->
    <circle cx="48" cy="48" r="28" />
    <path d="M36 49l8 8 16-17" />
    <path d="M16 78c10-5 20-5 32 0s22 5 32 0" opacity="0.4" />
  {:else}
    <!-- two stacked cards -->
    <rect x="20" y="30" width="46" height="34" rx="6" opacity="0.5" transform="rotate(-8 43 47)" />
    <rect x="30" y="26" width="46" height="34" rx="6" />
    <path d="M40 38h26M40 48h16" opacity="0.6" />
  {/if}
</svg>

<style>
  .ill {
    display: block;
    margin: 0 auto var(--space-3);
    color: var(--ink-muted);
  }

  .flame {
    stroke: var(--amber);
  }
</style>
