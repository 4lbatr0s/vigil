<script lang="ts">
  import { tick } from "svelte";
  import { goto } from "$app/navigation";
  import { listAgents, runAgent, searchNotes } from "$lib/api";
  import { buildCommands, type Command } from "$lib/commands";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let query = $state("");
  let agents = $state<string[]>([]);
  let noteHits = $state<{ id: string; title: string }[]>([]);
  let active = $state(0);
  let message = $state("");
  let input = $state<HTMLInputElement | null>(null);
  let returnTo: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const commands = $derived(buildCommands({ query, noteHits, agents }));

  $effect(() => {
    if (!open) return;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query = "";
    noteHits = [];
    active = 0;
    message = "";
    void listAgents().then((list) => (agents = list.map((a) => a.name))).catch(() => (agents = []));
    void tick().then(() => input?.focus());
  });

  // Note search is debounced so typing does not hit the server on every key.
  $effect(() => {
    const q = query.trim();
    clearTimeout(timer);
    if (!open || q.length < 2) {
      noteHits = [];
      return;
    }
    timer = setTimeout(() => {
      searchNotes(q)
        .then((hits) => (noteHits = hits.slice(0, 8).map((h) => ({ id: h.id, title: h.title }))))
        .catch(() => (noteHits = []));
    }, 150);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    // Keep the highlighted row inside the new list.
    if (active >= commands.length) active = Math.max(0, commands.length - 1);
  });

  function close(): void {
    open = false;
    returnTo?.focus();
  }

  async function activate(command: Command | undefined): Promise<void> {
    if (!command) return;
    if (command.action.type === "goto") {
      close();
      await goto(command.action.href);
      return;
    }
    const name = command.action.agent;
    try {
      await runAgent(name);
      close();
      await goto(`/agents/${encodeURIComponent(name)}`);
    } catch (err) {
      message = err instanceof Error ? err.message : "Could not start the run";
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      active = commands.length === 0 ? 0 : (active + 1) % commands.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = commands.length === 0 ? 0 : (active - 1 + commands.length) % commands.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      void activate(commands[active]);
    } else if (event.key === "Tab") {
      // Focus trap: the input is the only tab stop in the dialog.
      event.preventDefault();
    }
  }
</script>

{#if open}
  <div class="backdrop" role="presentation" onmousedown={close}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" onmousedown={(e) => e.stopPropagation()} onkeydown={onKeydown}>
      <input
        bind:this={input}
        bind:value={query}
        class="query"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={commands[active] ? `opt-${active}` : undefined}
        aria-label="Search notes, agents and commands"
        placeholder="Search notes, agents, commands"
        autocomplete="off"
        spellcheck="false"
      />
      <ul id="palette-list" class="list" role="listbox" aria-label="Results">
        {#each commands as c, i (c.id)}
          <li
            id={`opt-${i}`}
            class="opt"
            class:active={i === active}
            role="option"
            aria-selected={i === active}
            onmousemove={() => (active = i)}
            onclick={() => void activate(c)}
            onkeydown={() => {}}
          >
            <span class="group">{c.group}</span>
            <span class="label">{c.label}</span>
            {#if c.hint}<span class="hint">{c.hint}</span>{/if}
          </li>
        {:else}
          <li class="none" role="presentation">Nothing found</li>
        {/each}
      </ul>
      {#if message}<p class="error" role="alert">{message}</p>{/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    justify-items: center;
    align-items: start;
    padding-top: 14vh;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    z-index: 50;
  }
  .dialog {
    width: min(560px, calc(100vw - 32px));
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .query {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    border-bottom: 1px solid var(--hairline);
    background: transparent;
    font-size: var(--text-ui);
    outline: none;
  }
  .query:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 50vh;
    overflow-y: auto;
  }
  .opt {
    display: grid;
    grid-template-columns: 72px 1fr auto;
    gap: var(--space-3);
    align-items: baseline;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }
  .opt.active {
    background: var(--hairline);
  }
  .group,
  .hint {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .none {
    padding: var(--space-3) var(--space-4);
    color: var(--ink-muted);
  }
  .error {
    padding: var(--space-2) var(--space-4);
    color: var(--err);
    font-size: var(--text-label);
  }
</style>
