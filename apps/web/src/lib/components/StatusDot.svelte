<script lang="ts">
  import type { Dot } from "$lib/schedule";
  let { state, label }: { state: Dot; label?: string } = $props();
  const words: Record<Dot, string> = { running: "running", ok: "last run succeeded", err: "last run failed", idle: "idle" };
</script>

<span class="dot {state}" role="img" aria-label={label ?? words[state]} title={label ?? words[state]}></span>

<style>
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-2);
    flex: none;
  }
  .ok {
    background: var(--ok);
  }
  .err {
    background: var(--err);
  }
  .running {
    background: var(--amber);
  }
  @media (prefers-reduced-motion: no-preference) {
    .running {
      animation: breathe calc(var(--dur-slow) * 6) ease-in-out infinite;
    }
  }
  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }
</style>
