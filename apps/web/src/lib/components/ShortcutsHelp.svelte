<script lang="ts">
  import { Dialog, Kbd } from "$lib/ui";

  let { open = $bindable(false) }: { open: boolean } = $props();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl";

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Anywhere",
      rows: [
        [`${mod} K`, "Search notes and run commands"],
        ["C", "Capture a thought to your inbox"],
        ["⌘⇧F", "Focus mode: only the note"],
        ["N / A / D", "On an inbox line in Today: make a note, add to a note, delete"],
        ["?", "Show this list"],
        ["Esc", "Close a panel or menu"],
      ],
    },
    {
      title: "Writing",
      rows: [
        [`${mod} B / I / E`, "Bold, italic, code"],
        [`${mod} Shift K`, "Add a link"],
        [`${mod} Shift H`, "Hide the selection as a study blank"],
        [`${mod} Alt 1 / 2 / 3`, "Heading 1, 2, 3"],
        [`${mod} Shift 8 / 7 / 9`, "Bulleted, numbered, to-do list"],
        ["Tab / Shift Tab", "Indent a list item, outdent it"],
        ["/", "Insert a block or a study card"],
        ["[[", "Link to another note"],
        [`${mod} J`, "Ask a helper about the selection"],
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
        [`Z or ${mod} Z`, "Take back the last answer"],
      ],
    },
  ];

</script>

<Dialog bind:open title="Keyboard shortcuts" wide>
  <div class="cols">
    {#each groups as g (g.title)}
      <section>
        <h3>{g.title}</h3>
        <dl>
          {#each g.rows as [keys, what] (keys)}
            <div class="line"><dt><Kbd {keys} /></dt><dd>{what}</dd></div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
</Dialog>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--s-6);
  }

  h3 {
    margin: 0 0 var(--s-2);
    font: var(--weight-strong) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
  }

  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s-3);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  dt {
    flex: none;
  }

  dd {
    margin: 0;
    text-align: right;
    color: var(--text-2);
  }
</style>
