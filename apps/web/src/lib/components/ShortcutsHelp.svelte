<script lang="ts">
  import { tick } from "svelte";

  let { open = $bindable(false) }: { open: boolean } = $props();
  let dialogEl = $state<HTMLDivElement | undefined>();
  let opener: Element | null = null;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl";

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Anywhere",
      rows: [
        [`${mod} K`, "Search notes and run commands"],
        ["?", "Show this list"],
        ["Esc", "Close a panel or menu"],
      ],
    },
    {
      title: "Writing",
      rows: [
        [`${mod} B / I / E`, "Bold, italic, code"],
        [`${mod} Shift K`, "Add a link"],
        [`${mod} Alt 1 / 2 / 3`, "Heading 1, 2, 3"],
        [`${mod} Shift 8 / 7 / 9`, "Bulleted, numbered, to-do list"],
        ["Tab / Shift Tab", "Indent a list item, outdent it"],
        ["/", "Insert a block or a study card"],
        ["[[", "Link to another note"],
        [`${mod} J`, "Ask an agent about the selection"],
        [`${mod} S`, "Save now"],
      ],
    },
    {
      title: "Notes list",
      rows: [
        ["↑ / ↓", "Move between notes"],
        ["N", "Start a new note"],
      ],
    },
    {
      title: "Studying",
      rows: [
        ["Enter / Space", "Show the answer"],
        ["1 / 2 / 3 / 4", "Again, Hard, Good, Easy"],
      ],
    },
  ];

  $effect(() => {
    if (!open) return;
    opener = document.activeElement;
    void tick().then(() => dialogEl?.focus());
  });

  function close(): void {
    open = false;
    if (opener instanceof HTMLElement) opener.focus();
  }
</script>

{#if open}
  <button type="button" class="scrim" aria-label="Close" onclick={close}></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="sh-title"
    tabindex="-1"
    bind:this={dialogEl}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }}
  >
    <h2 id="sh-title">Keyboard shortcuts</h2>
    <div class="cols">
      {#each groups as g (g.title)}
        <section>
          <h3>{g.title}</h3>
          <dl>
            {#each g.rows as [keys, what] (keys)}
              <div class="row"><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
    <div class="actions"><button type="button" class="btn" onclick={close}>Close</button></div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }

  .dialog {
    position: fixed;
    z-index: 41;
    top: 8vh;
    left: 50%;
    display: grid;
    gap: var(--space-4);
    width: min(680px, calc(100vw - 2 * var(--space-4)));
    max-height: 84vh;
    overflow-y: auto;
    transform: translateX(-50%);
    padding: var(--space-6);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
  }

  h2 {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-4) var(--space-6);
  }

  h3 {
    margin-bottom: var(--space-2);
    font-size: var(--text-label);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    font-weight: 500;
    color: var(--ink-muted);
  }

  dl {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-ui);
  }

  dt {
    flex: none;
  }

  dd {
    margin: 0;
    text-align: right;
    color: var(--ink-muted);
  }

  kbd {
    padding: 1px 6px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  .btn {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }

  .btn:hover {
    background: var(--surface-hover);
  }
</style>
