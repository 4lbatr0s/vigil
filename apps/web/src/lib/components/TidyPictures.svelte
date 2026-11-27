<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getImageSettings, getModelCaps, getUnusedImages, putImageSettings, tidyImages } from "$lib/api";
  import { capabilityWarnings, type ModelCaps } from "$lib/model-caps";
  import { Button, Dialog, Stack, Switch } from "$lib/ui";

  let unused = $state<{ count: number; bytes: number } | null>(null);
  let asking = $state(false);
  let notice = $state("");
  let error = $state("");
  let busy = $state(false);
  let sees = $state(false);
  let caps = $state<ModelCaps | null>(null);
  const visionWarning = $derived(sees ? (capabilityWarnings({ tools: false, pictures: true }, caps).find((w) => w.includes("pictures")) ?? "") : "");

  const size = (bytes: number): string => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  onMount(async () => {
    try {
      unused = await getUnusedImages();
      sees = (await getImageSettings()).agentsSeePictures;
      caps = await getModelCaps().catch(() => null);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not check your pictures";
    }
  });

  async function setSees(on: boolean): Promise<void> {
    error = "";
    try {
      sees = (await putImageSettings({ agentsSeePictures: on })).agentsSeePictures;
    } catch (err) {
      sees = !on;
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    }
  }

  async function tidy(): Promise<void> {
    busy = true;
    error = "";
    try {
      const r = await tidyImages();
      notice = `Removed ${r.removed} ${r.removed === 1 ? "picture" : "pictures"} (${size(r.bytes)}).`;
      unused = { count: 0, bytes: 0 };
      asking = false;
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not tidy";
    } finally {
      busy = false;
    }
  }
</script>

{#if unused}
  <section aria-labelledby="pictures">
    <h2 id="pictures">Pictures</h2>
    <Stack gap={3}>
      <Switch label="Let the card maker and recall checker see the pictures in a note" checked={sees} onchange={(on) => void setSees(on)} />
      <p class="muted">Needs a model that can read images. The pictures go to your model provider.</p>
      {#if visionWarning}<p class="error" role="note">{visionWarning} (Your default model.)</p>{/if}
      {#if unused.count === 0}
        <p class="muted">{notice || "Every picture in your vault is used by a note."}</p>
      {:else}
        <p class="muted">{unused.count} {unused.count === 1 ? "picture is" : "pictures are"} not linked from any note ({size(unused.bytes)}). Only pictures over an hour old count.</p>
        <div><Button onclick={() => (asking = true)}>Remove unused pictures</Button></div>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </Stack>
  </section>
{/if}

<Dialog bind:open={asking} title="Remove unused pictures?" description={`This deletes ${unused?.count ?? 0} ${unused?.count === 1 ? "file" : "files"} from your vault for good. An older version of a note that used one (for example after undoing a helper) would show a missing picture.`}>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (asking = false)}>Keep them</Button>
    <Button variant="danger" disabled={busy} onclick={() => void tidy()}>Delete them</Button>
  {/snippet}
</Dialog>

<style>
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
