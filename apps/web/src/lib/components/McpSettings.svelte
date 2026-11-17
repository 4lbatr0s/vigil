<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getMcpSettings, putMcpSettings, type McpSettings } from "$lib/api";

  let settings = $state<McpSettings | null>(null);
  let notice = $state("");
  let error = $state("");
  const url = $derived(`${typeof location === "undefined" ? "" : location.origin}/api/mcp`);

  onMount(async () => {
    try {
      settings = await getMcpSettings();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load the MCP settings";
    }
  });

  async function save(next: McpSettings): Promise<void> {
    error = "";
    notice = "";
    try {
      settings = await putMcpSettings(next);
      notice = "Saved.";
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    }
  }
</script>

{#if settings}
  <section aria-labelledby="mcp-settings">
    <h2 id="mcp-settings">Other agents (MCP)</h2>
    <p class="muted">Let another AI tool, such as Claude Code or Claude Desktop, search and read your notes through the MCP standard. Off until you switch it on. It reaches your notes only through this address, with the same access token as the rest of Vigil.</p>
    <label class="check">
      <input type="checkbox" checked={settings.enabled} onchange={(e) => void save({ enabled: e.currentTarget.checked, write: settings!.write })} />
      <span>Allow other agents to read my notes</span>
    </label>
    <label class="check">
      <input type="checkbox" checked={settings.write} disabled={!settings.enabled} onchange={(e) => void save({ enabled: settings!.enabled, write: e.currentTarget.checked })} />
      <span>Also allow them to write notes (each write is saved as a run you can undo)</span>
    </label>
    {#if settings.enabled}
      <p class="muted">Address: <code>{url}</code></p>
    {/if}
    <p class="muted" aria-live="polite">{notice}</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .check {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin-bottom: var(--space-2);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  .error {
    color: var(--err-ink);
  }
</style>
