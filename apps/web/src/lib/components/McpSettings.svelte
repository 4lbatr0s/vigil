<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, getMcpSettings, putMcpSettings, type McpSettings } from "$lib/api";
  import { claudeCodeCommand, vaultRules } from "$lib/vault-rules";
  import { Button, Switch, Stack } from "$lib/ui";

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
    <Stack gap={3}>
      <Switch label="Allow other agents to read my notes" checked={settings.enabled} onchange={(on) => void save({ enabled: on, write: settings!.write })} />
      <Switch label="Also let them write notes (each write is a run you can undo)" checked={settings.write} onchange={(on) => void save({ enabled: settings!.enabled, write: on })} />
      {#if settings.enabled}
        <p class="muted">Address: <code>{url}</code></p>
      {/if}
      <details class="rules">
        <summary>Use it with Claude Code, Codex or another tool</summary>
        <Stack gap={3}>
          <p class="muted">The first command adds Vigil to Claude Code. The second is a short rules file: save it in your vault as <code>AGENTS.md</code> (or <code>CLAUDE.md</code>) so any tool that works in the folder keeps your notes safe.</p>
          {#if settings.enabled}
            <pre><code>{claudeCodeCommand(url)}</code></pre>
            <div><Button size="sm" onclick={() => void copy("command", claudeCodeCommand(url))}>{copied === "command" ? "Copied" : "Copy command"}</Button></div>
          {/if}
          <pre><code>{vaultRules(settings.enabled ? url : "")}</code></pre>
          <div><Button size="sm" onclick={() => void copy("rules", vaultRules(settings?.enabled ? url : ""))}>{copied === "rules" ? "Copied" : "Copy rules"}</Button></div>
        </Stack>
      </details>
    </Stack>
    <p class="muted" aria-live="polite">{notice}</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .rules summary {
    margin-bottom: var(--s-3);
    color: var(--text-2);
    cursor: pointer;
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  pre {
    margin: 0;
    padding: var(--s-3);
    max-height: 16rem;
    overflow: auto;
    border-radius: var(--r-surface);
    background: var(--fill-hover);
    white-space: pre-wrap;
  }

  code {
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-code);
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
