<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import NotebookText from "@lucide/svelte/icons/notebook-text";
  import { Badge, Button, Checkbox, Cluster, Dialog, EmptyState, Field, IconButton, Input, Kbd, Menu, Row, Select, Stack, Switch, Tabs, Textarea, ViewSwitch } from "$lib/ui";

  let theme = $state<"system" | "light" | "dark">("system");
  let density = $state<"comfortable" | "compact">("comfortable");
  let dialogOpen = $state(false);
  let name = $state("");
  let selected = $state("enthalpy");
  let autoFile = $state(true);
  let tab = $state("notes");
  let level = $state("daily");
  let notes2 = $state("");
  let agree = $state(true);

  $effect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    root.setAttribute("data-density", density);
    return () => {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-density");
    };
  });

  const notes = [
    { id: "enthalpy", title: "Enthalpy and heat", meta: "2 h", snippet: "Enthalpy is the heat content of a system at constant pressure." },
    { id: "kickoff", title: "Project kickoff", meta: "Yesterday", snippet: "Agree on scope, draft the schedule, share the plan." },
    { id: "reading", title: "Reading list", meta: "Mon", snippet: "A short list of things to read this month." },
  ];

  const swatches = [
    ["--paper", "Paper"],
    ["--paper-sunk", "Sunk"],
    ["--paper-float", "Float"],
    ["--text", "Text"],
    ["--text-2", "Text 2"],
    ["--text-3", "Text 3"],
    ["--fill-selected", "Selected"],
    ["--line", "Line"],
    ["--agent", "Helper"],
    ["--good", "Good"],
    ["--danger", "Danger"],
    ["--focus", "Focus"],
  ];
</script>

<svelte:head><title>Design</title></svelte:head>

<div class="guide">
  <header class="bar">
    <h1>Design</h1>
    <Cluster gap={3}>
      <Tabs tabs={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} bind:value={theme} panel={empty} />
      <Switch label="Compact" checked={density === "compact"} onchange={(v) => (density = v ? "compact" : "comfortable")} />
    </Cluster>
  </header>

  <Stack gap={12}>
    <section>
      <h2>Type</h2>
      <div class="type-scale">
        <p class="t-title">Enthalpy and heat</p>
        <p class="t-heading">Key points</p>
        <p class="t-body">Enthalpy is the heat content of a system at constant pressure. Exothermic reactions release heat, so the change is negative.</p>
        <p class="t-ui">Interface text, labels and buttons use this size.</p>
        <p class="t-meta">Meta text: times, counts, hints</p>
      </div>
    </section>

    <section>
      <h2>Colour</h2>
      <div class="swatches">
        {#each swatches as [token, label] (token)}
          <div class="swatch"><span class="swatch-dot" style:background="var({token})"></span><span>{label}</span></div>
        {/each}
      </div>
    </section>

    <section>
      <h2>Buttons</h2>
      <Stack gap={4}>
        <Cluster gap={2}>
          <Button variant="primary">{#snippet icon()}<Plus size={16} />{/snippet}New note</Button>
          <Button>Study</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete note</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </Cluster>
        <Cluster gap={1}>
          <IconButton label="Search" shortcut="⌘K"><Search size={16} /></IconButton>
          <IconButton label="New note"><Plus size={16} /></IconButton>
          <IconButton label="Bold" pressed><NotebookText size={16} /></IconButton>
          <Menu
            label="More actions"
            items={[
              { label: "Make cards", onselect: () => {} },
              { label: "Canvas", onselect: () => {} },
              { label: "Recall check", onselect: () => {} },
              { kind: "separator" },
              { label: "Delete note", danger: true, onselect: () => (dialogOpen = true) },
            ]}
          >
            {#snippet trigger({ props })}
              <button {...props} class="more" aria-label="More actions"><Ellipsis size={16} /></button>
            {/snippet}
          </Menu>
        </Cluster>
      </Stack>
    </section>

    <section>
      <h2>Fields</h2>
      <div class="narrow">
        <Stack gap={4}>
          <Field label="Note title" hint="Used as the file name.">
            {#snippet children({ id, describedby, invalid })}
              <Input {id} aria-describedby={describedby} {invalid} bind:value={name} placeholder="Untitled" />
            {/snippet}
          </Field>
          <Field label="Model name" error="Enter the name your provider uses.">
            {#snippet children({ id, describedby, invalid })}
              <Input {id} aria-describedby={describedby} {invalid} value="" />
            {/snippet}
          </Field>
          <Field label="Runs">
            {#snippet children({ id })}
              <Select {id} bind:value={level}>
                <option value="manual">Only when I start it</option>
                <option value="daily">Every day</option>
              </Select>
            {/snippet}
          </Field>
          <Field label="Your answer">
            {#snippet children({ id })}<Textarea {id} rows={3} bind:value={notes2} placeholder="Write what you remember" />{/snippet}
          </Field>
          <Checkbox label="Keep this card" detail="Saved with the form." bind:checked={agree} />
          <Switch label="File my inbox automatically" bind:checked={autoFile} />
        </Stack>
      </div>
    </section>

    <section>
      <h2>List rows</h2>
      <div class="list">
        {#each notes as n (n.id)}
          <Row title={n.title} meta={n.meta} snippet={n.snippet} selected={selected === n.id} onclick={() => (selected = n.id)} />
        {/each}
      </div>
      <p class="note">Selected is a soft fill, never an outline.</p>
    </section>

    <section>
      <h2>Badges and keys</h2>
      <Cluster gap={3}>
        <Badge>3</Badge>
        <Badge tone="agent">Written by morning-digest</Badge>
        <Badge tone="danger">Failed</Badge>
        <Kbd keys="⌘K" />
        <Kbd keys="⌥↑" />
      </Cluster>
    </section>

    <section>
      <h2>Tabs</h2>
      <Tabs tabs={[{ value: "notes", label: "Notes" }, { value: "cards", label: "Cards" }, { value: "recall", label: "Recall" }]} bind:value={tab} panel={panel} />
    </section>

    <section>
      <h2>View switch</h2>
      <ViewSwitch label="Ways to see your notes" current="/design" items={[{ href: "/design", label: "List" }, { href: "/graph", label: "Graph" }, { href: "/canvas", label: "Boards" }]} />
    </section>

    <section>
      <h2>Empty state</h2>
      <EmptyState title="No helpers yet.">
        {#snippet action()}<Button variant="primary">Create a helper</Button>{/snippet}
      </EmptyState>
    </section>

    <section>
      <h2>Dialog</h2>
      <Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
    </section>
  </Stack>
</div>

{#snippet empty()}{/snippet}
{#snippet panel(value: string)}<p class="note">Content for {value}.</p>{/snippet}

<Dialog bind:open={dialogOpen} title="Delete this note?" description="It moves out of your vault. Helpers can no longer read it.">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (dialogOpen = false)}>Keep it</Button>
    <Button variant="danger" onclick={() => (dialogOpen = false)}>{#snippet icon()}<Trash2 size={16} />{/snippet}Delete note</Button>
  {/snippet}
</Dialog>

<style>
  .guide {
    box-sizing: border-box;
    max-width: 880px;
    margin: 0 auto;
    padding: var(--s-8) var(--s-6) var(--s-16);
    background: var(--paper);
    color: var(--text);
    font-family: var(--font-ui);
    min-height: 100%;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    margin-bottom: var(--s-10);
  }

  h1 {
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-prose);
    letter-spacing: var(--type-title-tracking);
  }

  h2 {
    margin-bottom: var(--s-4);
    color: var(--text-2);
    font: var(--weight-medium) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .type-scale {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .t-title {
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-prose);
    letter-spacing: var(--type-title-tracking);
  }
  .t-heading {
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }
  .t-body {
    max-width: var(--measure);
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-prose);
  }
  .t-ui {
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }
  .t-meta {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--s-3);
  }

  .swatch {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .swatch-dot {
    width: 28px;
    height: 28px;
    border-radius: var(--r-control);
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }

  .narrow {
    max-width: 360px;
  }

  .list {
    max-width: 360px;
  }

  .note {
    margin-top: var(--s-2);
    color: var(--text-2);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-h);
    height: var(--control-h);
    border-radius: var(--r-control);
    color: var(--text-2);
  }

  .more:hover {
    background: var(--fill-hover);
    color: var(--text);
  }
</style>
