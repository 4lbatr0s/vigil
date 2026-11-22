<script lang="ts">
  import type { EditorView } from "@codemirror/view";
  import Bold from "@lucide/svelte/icons/bold";
  import Italic from "@lucide/svelte/icons/italic";
  import Strikethrough from "@lucide/svelte/icons/strikethrough";
  import Code from "@lucide/svelte/icons/code";
  import Link from "@lucide/svelte/icons/link";
  import Heading2 from "@lucide/svelte/icons/heading-2";
  import Quote from "@lucide/svelte/icons/quote";
  import List from "@lucide/svelte/icons/list";
  import Bot from "@lucide/svelte/icons/bot";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import { boldCommand, clozeCommand, codeCommand, headingCommand, italicCommand, lineCommand, linkCommand, strikeCommand, type Command } from "$lib/editor/format";

  let { view, left, top, onask }: { view: EditorView; left: number; top: number; onask?: () => void } = $props();

  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const buttons: { label: string; keys: string; icon: typeof Bold; run: Command }[] = [
    { label: "Bold", keys: `${mod}B`, icon: Bold, run: boldCommand },
    { label: "Italic", keys: `${mod}I`, icon: Italic, run: italicCommand },
    { label: "Strikethrough", keys: `${mod}⇧X`, icon: Strikethrough, run: strikeCommand },
    { label: "Code", keys: `${mod}E`, icon: Code, run: codeCommand },
    { label: "Link", keys: `${mod}⇧K`, icon: Link, run: linkCommand },
    { label: "Hide as a study blank", keys: `${mod}⇧H`, icon: EyeOff, run: clozeCommand },
    { label: "Heading", keys: `${mod}⌥2`, icon: Heading2, run: headingCommand(2) },
    { label: "Quote", keys: "", icon: Quote, run: lineCommand("quote") },
    { label: "Bulleted list", keys: `${mod}⇧8`, icon: List, run: lineCommand("bullet") },
  ];

  function press(run: Command): void {
    run(view);
    view.focus();
  }
</script>

<!-- mousedown is cancelled so the click never moves focus out of the editor and the selection survives. -->
<div class="bar" role="toolbar" tabindex="-1" aria-label="Format selection" style:left={`${left}px`} style:top={`${top}px`} onmousedown={(e) => e.preventDefault()}>
  {#each buttons as b (b.label)}
    {@const Icon = b.icon}
    <button type="button" aria-label={b.label} title={b.keys ? `${b.label} (${b.keys})` : b.label} onclick={() => press(b.run)}>
      <Icon size={16} strokeWidth={1.5} />
    </button>
  {/each}
  {#if onask}
    <span class="sep" aria-hidden="true"></span>
    <button type="button" aria-label="Ask an agent" title={`Ask an agent (${mod}J)`} onclick={onask}>
      <Bot size={16} strokeWidth={1.5} />
    </button>
  {/if}
</div>

<style>
  .bar {
    position: absolute;
    z-index: 5;
    display: flex;
    gap: 2px;
    padding: var(--s-1);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-control);
    background: var(--paper-float);
    box-shadow: var(--elev-float);
  }

  button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--r-control);
    color: var(--text);
  }

  .sep {
    width: 1px;
    margin: 4px 2px;
    background: var(--line-soft);
  }

  button:hover {
    background: var(--fill-selected);
  }
</style>
