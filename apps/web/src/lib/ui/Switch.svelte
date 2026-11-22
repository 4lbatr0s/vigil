<script lang="ts">
  import { Switch } from "bits-ui";

  /** An on/off setting that takes effect at once. The label is always visible and says what is on. */
  type Props = { checked?: boolean; label: string; onchange?: (checked: boolean) => void };
  let { checked = $bindable(false), label, onchange }: Props = $props();
</script>

<label class="switch">
  <Switch.Root bind:checked class="track" onCheckedChange={onchange}>
    <Switch.Thumb class="thumb" />
  </Switch.Root>
  <span>{label}</span>
</label>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    gap: var(--s-3);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  :global(.track) {
    display: inline-flex;
    flex: none;
    align-items: center;
    width: 36px;
    height: 20px;
    padding: 2px;
    border-radius: var(--r-pill);
    background: var(--fill-pressed);
    transition: background-color var(--dur-base) var(--ease-out);
  }

  :global(.track[data-state="checked"]) {
    background: var(--text);
  }

  :global(.thumb) {
    width: 16px;
    height: 16px;
    border-radius: var(--r-pill);
    background: var(--paper-float);
    box-shadow: var(--shadow-thumb);
    transition: transform var(--dur-base) var(--ease-out);
  }

  :global(.thumb[data-state="checked"]) {
    transform: translateX(16px);
  }
</style>
