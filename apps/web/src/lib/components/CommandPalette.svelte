<script lang="ts">
    import { goto } from "$app/navigation";
  import { listAgents, runAgent, searchNotes } from "$lib/api";
  import { buildCommands, type Command } from "$lib/commands";
  import { Dialog } from "$lib/ui";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let query = $state("");
  let agents = $state<string[]>([]);
  let noteHits = $state<{ id: string; title: string }[]>([]);
  let active = $state(0);
  let message = $state("");
    let timer: ReturnType<typeof setTimeout> | undefined;

  const commands = $derived(buildCommands({ query, noteHits, agents }));

  $effect(() => {
    if (!open) return;
    query = "";
    noteHits = [];
    active = 0;
    message = "";
    void listAgents().then((list) => (agents = list.map((a) => a.name))).catch(() => (agents = []));
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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = commands.length === 0 ? 0 : (active + 1) % commands.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = commands.length === 0 ? 0 : (active - 1 + commands.length) % commands.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      void activate(commands[active]);
    }
  }
</script>

<Dialog bind:open title="Command palette" hideTitle placement="top">
  <div class="palette" role="presentation" onkeydown={onKeydown}>
    <input
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
        <li id={`opt-${i}`} class="opt" class:active={i === active} role="option" aria-selected={i === active} onmousemove={() => (active = i)} onclick={() => void activate(c)} onkeydown={() => {}}>
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
</Dialog>

<style>
  .palette {
    display: flex;
    flex-direction: column;
  }

  .query {
    width: 100%;
    height: calc(var(--control-h) + var(--s-4));
    padding: 0 var(--s-5);
    border: 0;
    border-radius: var(--r-float) var(--r-float) 0 0;
    background: transparent;
    color: var(--text);
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-ui);
    box-shadow: 0 1px 0 var(--line-soft);
  }

  .query::placeholder {
    color: var(--text-3);
  }

  .query:focus-visible {
    outline: none;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: var(--s-1);
    max-height: 50vh;
    overflow-y: auto;
  }

  .opt {
    display: grid;
    grid-template-columns: 72px 1fr auto;
    gap: var(--s-3);
    align-items: baseline;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    cursor: pointer;
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .opt.active {
    background: var(--fill-selected);
  }

  .group,
  .hint {
    color: var(--text-3);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .none {
    padding: var(--s-3);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .error {
    margin: 0;
    padding: var(--s-2) var(--s-4);
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
</style>
