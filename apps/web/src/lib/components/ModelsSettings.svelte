<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, deleteConnection, listConnections, probeConnection, probeConnectionTools, setDefaultConnection, type Connection } from "$lib/api";
  import ConnectionWizard from "$lib/components/ConnectionWizard.svelte";
  import { Badge, Button, Cluster, Dialog, Stack } from "$lib/ui";

  let connections = $state<Connection[] | null>(null);
  let adding = $state(false);
  let editing = $state<Connection | null>(null);
  let confirmRemove = $state<string | null>(null);
  let removeOpen = $state(false);
  let results = $state<Record<string, string>>({});
  let error = $state("");

  async function load(): Promise<void> {
    try {
      connections = await listConnections();
      // A first visit with nothing connected opens the add form at once.
      if (connections.length === 0) adding = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load connections";
    }
  }
  onMount(() => void load());

  async function test(c: Connection): Promise<void> {
    results[c.id] = "Testing…";
    try {
      const r = await probeConnection({ kind: c.kind, baseUrl: c.baseUrl, ...(c.readOnly ? {} : { connectionId: c.id }) });
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      results[c.id] = `${r.ok ? `Reachable, ${r.models.length} ${r.models.length === 1 ? "model" : "models"}.` : (r.error ?? "Not reachable.")} Tested ${at}.`;
    } catch (err) {
      results[c.id] = err instanceof Error ? err.message : "Could not test";
    }
  }

  async function checkTools(c: Connection): Promise<void> {
    results[c.id] = "Asking the model to call a tool…";
    try {
      const r = await probeConnectionTools({ connectionId: c.id });
      results[c.id] = r.message;
    } catch (err) {
      results[c.id] = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not check";
    }
  }

  async function makeDefault(c: Connection): Promise<void> {
    error = "";
    try {
      connections = await setDefaultConnection(c.id);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : "Could not change the default";
    }
  }

  async function remove(c: Connection): Promise<void> {
    error = "";
    try {
      await deleteConnection(c.id);
      confirmRemove = null;
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : "Could not remove it";
    }
  }

  function saved(): void {
    adding = false;
    editing = null;
    void load();
  }

  const kindLabel = (k: Connection["kind"]): string => (k === "anthropic" ? "Anthropic" : k === "ollama" ? "Ollama" : "OpenAI-compatible");
</script>

<section aria-labelledby="models-h" id="models">
  <h2 id="models-h">AI models</h2>
  <p class="muted">Connect a model on this computer or one of your own accounts. Helpers use the default unless you pick another on their page. Keys are stored encrypted here and never shown again.</p>

  {#if connections === null}
    <p class="muted">Loading…</p>
  {:else}
    <Stack gap={4}>
      <ul class="list">
        {#each connections as c (c.id)}
          <li>
            <div class="top">
              <strong>{c.name}</strong>
              <Badge>{kindLabel(c.kind)}</Badge>
              {#if c.isDefault}<Badge tone="agent">default</Badge>{/if}
              {#if c.readOnly}<Badge>from the environment</Badge>{/if}
            </div>
            <div class="detail">{c.baseUrl} · {c.defaultModel ?? "no model chosen"} · {c.hasKey ? "key saved" : "no key"}</div>
            <Cluster gap={1}>
              <Button variant="ghost" size="sm" onclick={() => void test(c)}>Test</Button>
              {#if c.defaultModel}<Button variant="ghost" size="sm" onclick={() => void checkTools(c)}>Check tools</Button>{/if}
              {#if !c.isDefault}<Button variant="ghost" size="sm" onclick={() => void makeDefault(c)}>Make default</Button>{/if}
              {#if !c.readOnly}
                <Button variant="ghost" size="sm" onclick={() => ((editing = c), (adding = false))}>Change</Button>
                <Button variant="ghost" size="sm" onclick={() => ((confirmRemove = c.id), (removeOpen = true))}>Remove</Button>
              {/if}
              {#if results[c.id]}<span class="muted" aria-live="polite">{results[c.id]}</span>{/if}
            </Cluster>
          </li>
        {/each}
      </ul>
      {#if editing}
        <ConnectionWizard existing={connections} {editing} onDone={saved} onCancel={() => (editing = null)} />
      {:else if adding}
        <ConnectionWizard existing={connections} onDone={saved} onCancel={() => (adding = false)} />
      {:else}
        <div><Button variant="primary" onclick={() => (adding = true)}>Add a connection</Button></div>
      {/if}
    </Stack>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<Dialog bind:open={removeOpen} title="Remove this connection?" description="Helpers using it stop until you pick another.">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (removeOpen = false)}>Keep it</Button>
    <Button variant="danger" onclick={() => { const c = connections?.find((x) => x.id === confirmRemove); removeOpen = false; if (c) void remove(c); }}>Remove connection</Button>
  {/snippet}
</Dialog>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: center;
  }

  .detail {
    margin: var(--s-1) 0 var(--s-1);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-code);
    overflow-wrap: anywhere;
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
