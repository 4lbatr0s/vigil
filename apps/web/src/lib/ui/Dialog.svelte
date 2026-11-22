<script lang="ts">
  import type { Snippet } from "svelte";
  import { Dialog } from "bits-ui";

  /**
   * The one dialog. Focus is trapped and returned, Escape closes it. Keep the title a short noun
   * phrase and the primary button a verb ("Delete note", not "OK"). `description` is optional.
   * Bind `open` to show it; the actions snippet holds the buttons (primary last).
   */
  type Props = { open?: boolean; title: string; description?: string; children?: Snippet; actions?: Snippet };
  let { open = $bindable(false), title, description, children, actions }: Props = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dlg-scrim" />
    <Dialog.Content class="dlg">
      <Dialog.Title class="dlg-title">{title}</Dialog.Title>
      {#if description}<Dialog.Description class="dlg-desc">{description}</Dialog.Description>{/if}
      {#if children}<div class="dlg-body">{@render children()}</div>{/if}
      {#if actions}<div class="dlg-actions">{@render actions()}</div>{/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dlg-scrim) {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: var(--scrim);
  }

  :global(.dlg) {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 71;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    width: min(440px, calc(100vw - var(--s-8)));
    padding: var(--s-6);
    border-radius: var(--r-float);
    background: var(--paper-float);
    box-shadow: var(--elev-overlay);
    transform: translate(-50%, -50%);
  }

  :global(.dlg-title) {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  :global(.dlg-desc) {
    margin: 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  :global(.dlg-actions) {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
</style>
