<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, deleteConnection, listConnections, probeConnection, setDefaultConnection, type Connection } from "$lib/api";
  import ConnectionWizard from "$lib/components/ConnectionWizard.svelte";

  let connections = $state<Connection[] | null>(null);
  let adding = $state(false);
  let editing = $state<Connection | null>(null);
  let confirmRemove = $state<string | null>(null);
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
  <p class="muted">Connect a model on this computer or one of your own accounts. Agents use the default connection unless you pick another on their page. Keys are stored encrypted here and never shown again.</p>

  {#if connections === null}
    <p class="muted">Loading…</p>
  {:else}
    <ul class="list">
      {#each connections as c (c.id)}
        <li>
          <div class="top">
            <strong>{c.name}</strong>
            <span class="tag">{kindLabel(c.kind)}</span>
            {#if c.isDefault}<span class="tag on">default</span>{/if}
            {#if c.readOnly}<span class="tag">from the environment</span>{/if}
          </div>
          <div class="mono muted">{c.baseUrl} · {c.defaultModel ?? "no model chosen"} · {c.hasKey ? "key saved" : "no key"}</div>
          <div class="actions">
            <button type="button" class="ghost" onclick={() => void test(c)}>Test</button>
            {#if !c.isDefault}<button type="button" class="ghost" onclick={() => void makeDefault(c)}>Make default</button>{/if}
            {#if !c.readOnly}
              <button type="button" class="ghost" onclick={() => ((editing = c), (adding = false))}>Change</button>
              {#if confirmRemove === c.id}
                <span class="muted">Remove it? Agents using it will stop until you pick another.</span>
                <button type="button" class="ghost danger" onclick={() => void remove(c)}>Remove</button>
                <button type="button" class="ghost" onclick={() => (confirmRemove = null)}>Keep</button>
              {:else}
                <button type="button" class="ghost" onclick={() => (confirmRemove = c.id)}>Remove</button>
              {/if}
            {/if}
            {#if results[c.id]}<span class="muted" aria-live="polite">{results[c.id]}</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if editing}
      <ConnectionWizard existing={connections} {editing} onDone={saved} onCancel={() => (editing = null)} />
    {:else if adding}
      <ConnectionWizard existing={connections} onDone={saved} onCancel={() => (adding = false)} />
    {:else}
      <p><button type="button" class="primary" onclick={() => (adding = true)}>Add a connection</button></p>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  li {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .tag {
    padding: 0 var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .tag.on {
    color: var(--ink);
    border-color: var(--ink);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  button.ghost,
  button.primary {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--text-label);
    cursor: pointer;
  }
  button.primary {
    padding: var(--space-2) var(--space-4);
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
    font-size: var(--text-ui);
  }
  button.ghost {
    background: transparent;
    color: var(--ink);
  }
  button.danger {
    color: var(--err-ink);
    border-color: var(--err);
  }
  .error {
    color: var(--err-ink);
  }
</style>
