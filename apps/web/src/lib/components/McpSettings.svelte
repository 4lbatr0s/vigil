<script lang="ts">
  import { onMount } from "svelte";
  import { ApiError, createMcpClient, getMcpSettings, listMcpClients, putMcpSettings, revokeMcpClient, type McpClient, type McpSettings } from "$lib/api";
  import { parseTagList } from "$lib/agent-form";
  import { claudeCodeCommand, vaultRules } from "$lib/vault-rules";
  import { formatStamp } from "$lib/format";
  import { Button, Cluster, Field, Input, Switch, Stack } from "$lib/ui";

  let settings = $state<McpSettings | null>(null);
  let clients = $state<McpClient[]>([]);
  let clientName = $state("");
  let clientTags = $state("");
  /** The token of the client just created. It is shown once and dropped when the page is left. */
  let fresh = $state<{ name: string; token: string } | null>(null);
  let notice = $state("");
  let error = $state("");
  const url = $derived(`${typeof location === "undefined" ? "" : location.origin}/api/mcp`);

  onMount(async () => {
    try {
      settings = await getMcpSettings();
      clients = await listMcpClients().catch(() => []);
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

  async function addClient(): Promise<void> {
    error = "";
    try {
      const made = await createMcpClient(clientName, parseTagList(clientTags));
      fresh = { name: made.name, token: made.token };
      clientName = "";
      clientTags = "";
      clients = await listMcpClients();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not create the client";
    }
  }

  async function removeClient(c: McpClient): Promise<void> {
    error = "";
    try {
      await revokeMcpClient(c.id);
      if (fresh?.name === c.name) fresh = null;
      clients = await listMcpClients();
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not revoke it";
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
    <h2 id="mcp-settings">Other AI tools (MCP)</h2>
    <p class="muted">Let another AI tool, such as Claude Code or Claude Desktop, search and read your notes through the MCP standard. Off until you switch it on. It reaches your notes only through this address, with the same access token as the rest of Vigil or with a client token from the list below.</p>
    <Stack gap={3}>
      <Switch label="Allow other AI tools to read my notes" checked={settings.enabled} onchange={(on) => void save({ enabled: on, write: settings!.write })} />
      <Switch label="Also let them write notes (each write is a run you can undo)" checked={settings.write} onchange={(on) => void save({ enabled: settings!.enabled, write: on })} />
      {#if settings.enabled}
        <p class="muted">Address: <code>{url}</code></p>
      {/if}
      <Stack gap={2}>
        <h3>Named clients</h3>
        <p class="muted">Give each tool its own token. The run list then shows which tool wrote a note, and you can cut one tool off without touching the others. A client token works only on the address above.</p>
        {#each clients as c (c.id)}
          <Cluster gap={2}>
            <strong>{c.name}</strong>
            <span class="muted">{c.lastUsedAt ? `used ${formatStamp(c.lastUsedAt)}` : "never used"}</span>
            {#if c.writeTags.length > 0}<span class="muted">writes only {c.writeTags.map((t) => `#${t}`).join(", ")}</span>{/if}
            <Button variant="ghost" size="sm" onclick={() => void removeClient(c)}>Revoke</Button>
          </Cluster>
        {/each}
        {#if fresh}
          <div class="fresh" role="status">
            <p class="muted">Token for {fresh.name}. Copy it now: it is shown only once.</p>
            <pre><code>{fresh.token}</code></pre>
            <div><Button size="sm" onclick={() => void copy("token", fresh!.token)}>{copied === "token" ? "Copied" : "Copy token"}</Button></div>
          </div>
        {/if}
        <Stack gap={3}>
          <Field label="Client name">
            {#snippet children({ id })}<span class="w-narrow"><Input {id} bind:value={clientName} maxlength={60} placeholder="claude-desktop" /></span>{/snippet}
          </Field>
          <Field label="Only write notes tagged" hint="Empty means any note. Set when the client is made.">
            {#snippet children({ id, describedby })}<span class="w-narrow"><Input {id} aria-describedby={describedby} bind:value={clientTags} placeholder="Any note" /></span>{/snippet}
          </Field>
          <div><Button disabled={clientName.trim() === ""} onclick={() => void addClient()}>Create client</Button></div>
        </Stack>
      </Stack>
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

  h3 {
    margin: 0;
    font: var(--weight-strong) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .w-narrow {
    display: inline-block;
    width: 16rem;
    max-width: 100%;
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
