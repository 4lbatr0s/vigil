<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getMcpSettings, putMcpSettings, type McpSettings } from "$lib/api";
  import { claudeCodeCommand, vaultRules } from "$lib/vault-rules";

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

  let copied = $state("");
  async function copy(what: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
    } catch {
      copied = "";
      error = "Copy did not work in this browser. Select the text and copy it by hand.";
    }
  }

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
    <details class="rules">
      <summary>Use it with Claude Code, Codex or another tool</summary>
      <p class="muted">Two copy-and-paste helps. The first adds Vigil to Claude Code. The second is a short rules file: save it in your vault as <code>AGENTS.md</code> (or <code>CLAUDE.md</code>) so any tool that works in the folder keeps your notes safe.</p>
      {#if settings.enabled}
        <pre><code>{claudeCodeCommand(url)}</code></pre>
        <button type="button" class="copy" onclick={() => void copy("command", claudeCodeCommand(url))}>{copied === "command" ? "Copied" : "Copy command"}</button>
      {/if}
      <pre><code>{vaultRules(settings.enabled ? url : "")}</code></pre>
      <button type="button" class="copy" onclick={() => void copy("rules", vaultRules(settings?.enabled ? url : ""))}>{copied === "rules" ? "Copied" : "Copy rules"}</button>
    </details>
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
  .rules {
    margin: var(--space-3) 0;
  }
  .rules summary {
    cursor: pointer;
  }
  pre {
    margin: var(--space-2) 0;
    padding: var(--space-3);
    max-height: 16rem;
    overflow: auto;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    white-space: pre-wrap;
  }
  .copy {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
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
