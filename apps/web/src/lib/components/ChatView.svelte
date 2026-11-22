<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    ApiError,
    createChat,
    deleteChat,
    getAgent,
    getChat,
    getLlmStatus,
    getModelCaps,
    listAgents,
    listChats,
    saveChat,
    streamTurn,
    type ChatMessage,
    type ChatThread,
  } from "$lib/api";
  import type { Agent } from "@vigil/shared";
  import { takeDraft } from "$lib/chat-draft";
  import { applyLine, emptyLive, lastIsUser, speakerOf, type Live } from "$lib/chat-view";
  import { agoText } from "$lib/format";
  import { refreshOnLive } from "$lib/live";
  import { capabilityWarnings, type ModelCaps } from "$lib/model-caps";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Plus from "@lucide/svelte/icons/plus";
  import { Button, Dialog, EmptyState, Field, IconButton, Menu, Row, Select, Textarea } from "$lib/ui";

  let { id = null }: { id?: string | null } = $props();

  let threads = $state<ChatThread[]>([]);
  let agents = $state<string[]>([]);
  let thread = $state<ChatThread | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let live = $state<Live | null>(null);
  let draft = $state("");
  let error = $state("");
  let notConfigured = $state("");
  let picking = $state(false);
  let pickAgent = $state("");
  let controller: AbortController | null = null;
  let saved = $state<{ id: string } | null>(null);
  let box = $state<HTMLTextAreaElement | undefined>();
  let scroller = $state<HTMLDivElement | null>(null);

  /** What the chat agent's model can do, so a model that cannot use tools is named before the first message. */
  let caps = $state<ModelCaps | null>(null);
  let chatAgent = $state<Agent | null>(null);
  const modelWarnings = $derived(chatAgent ? capabilityWarnings({ tools: chatAgent.tools.length > 0, pictures: false }, caps) : []);
  $effect(() => {
    const name = thread?.agent;
    caps = null;
    chatAgent = null;
    if (!name) return;
    let stale = false;
    void (async () => {
      try {
        const a = await getAgent(name);
        const c = await getModelCaps({ ...(a.connection ? { connection: a.connection } : {}), ...(a.model ? { model: a.model } : {}) });
        if (!stale) {
          chatAgent = a;
          caps = c;
        }
      } catch {
        // No warning is better than a wrong one.
      }
    })();
    return () => {
      stale = true;
    };
  });

  const streaming = $derived(live !== null && !live.done && live.error === null && controller !== null);
  const waiting = $derived(live?.waitingForApproval === true || (!streaming && lastIsUser(messages) && live === null));

  async function loadThreads(): Promise<void> {
    try {
      threads = await listChats();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load chats";
    }
  }

  async function loadThread(): Promise<void> {
    if (!id || controller) return; // never replace the view under a streaming turn
    try {
      const data = await getChat(id);
      thread = data.thread;
      messages = data.messages;
      if (live && (live.done || live.waitingForApproval)) live = null;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load the chat";
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const [list, status] = await Promise.all([listAgents(), getLlmStatus()]);
        agents = list.map((a) => a.name);
        pickAgent = agents[0] ?? "";
        if (status.model === null || (status.provider !== "ollama" && !status.hasKey)) {
          notConfigured = "No AI model is set up yet. Open Settings to see what to set.";
        }
      } catch {
        // The page still works for reading old chats.
      }
    })();
    void loadThreads();
    // The thread reloads when a run changes (an approval was decided and the reply arrived).
    return refreshOnLive(async () => {
      await loadThreads();
      await loadThread();
    }, ["run"], 4000);
  });

  // The command palette links to /chat?new=1: open the "Which agent?" picker.
  $effect(() => {
    if (page.url.searchParams.get("new") === "1") picking = true;
  });

  $effect(() => {
    void id;
    live = null;
    saved = null;
    error = "";
    void loadThread();
    // "Ask an agent" on a note hands its text over here; the person still presses Send.
    const handedOver = id ? takeDraft(id) : null;
    if (handedOver !== null) {
      draft = handedOver;
      void tick().then(() => box?.focus());
    }
  });

  async function scrollDown(): Promise<void> {
    await tick();
    scroller?.scrollTo({ top: scroller.scrollHeight });
  }

  async function startChat(): Promise<void> {
    if (!pickAgent) return;
    try {
      const t = await createChat(pickAgent);
      picking = false;
      await goto(`/chat/${t.id}`);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not start the chat";
    }
  }

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!id || !thread || text === "" || controller || notConfigured) return;
    error = "";
    draft = "";
    messages = [...messages, { seq: (messages.at(-1)?.seq ?? 0) + 1, role: "user", content: text, runId: null, createdAt: new Date().toISOString() }];
    live = emptyLive();
    controller = new AbortController();
    void scrollDown();
    try {
      await streamTurn(id, text, controller.signal, (line) => {
        if (live) live = applyLine(live, line);
        void scrollDown();
      });
    } catch (err) {
      if (controller?.signal.aborted) {
        // The person pressed Stop: the server cancels the turn and stores a note of it.
      } else if (err instanceof ApiError) {
        error = err.detail;
        messages = messages.slice(0, -1); // the server refused the turn before storing anything
        draft = text;
        live = null;
      } else {
        error = err instanceof Error ? err.message : "The connection was lost";
      }
    } finally {
      const waitingNow = live?.waitingForApproval === true;
      controller = null;
      if (!waitingNow) {
        await loadThread();
        live = null;
      } else {
        await loadThread();
      }
      void loadThreads();
      void scrollDown();
    }
  }

  function stop(): void {
    controller?.abort();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && controller) {
      stop();
    }
  }

  async function save(): Promise<void> {
    if (!id) return;
    try {
      saved = await saveChat(id);
    } catch (err) {
      error = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
    }
  }

  let confirmDelete = $state(false);
  async function remove(): Promise<void> {
    if (!id) return;
    try {
      await deleteChat(id);
      confirmDelete = false;
      await loadThreads();
      await goto("/chat");
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not delete the chat";
    }
  }
</script>

<svelte:head><title>{thread?.title ?? "Chat"} · Vigil</title></svelte:head>

<div class="chat">
  <aside class="threads" aria-label="Chats">
    <div class="threads-head">
      <h2>Chats</h2>
      <IconButton label="New chat" disabled={agents.length === 0} onclick={() => (picking = true)}><Plus size={16} strokeWidth={1.5} /></IconButton>
    </div>
    {#if agents.length === 0}<p class="muted pad">Chat needs an agent. <a href="/agents/new">Create one</a>.</p>{/if}
    <div class="thread-list">
      {#each threads as t (t.id)}
        <Row title={t.title} meta={agoText(t.updatedAt)} snippet={t.agent} selected={t.id === id} href={`/chat/${t.id}`} />
      {/each}
    </div>
  </aside>

  <section class="conversation" aria-label="Conversation">
    {#if !id}
      <div class="blank">
        {#if agents.length === 0}
          <EmptyState title="Chat talks to an agent. Create one first.">
            {#snippet action()}<Button variant="primary" href="/agents/new">Create an agent</Button>{/snippet}
          </EmptyState>
        {:else}
          <EmptyState title="Pick a chat on the left, or start a new one.">
            {#snippet action()}<Button variant="primary" onclick={() => (picking = true)}>New chat</Button>{/snippet}
          </EmptyState>
        {/if}
      </div>
    {:else if !thread}
      <p class="blank muted">{error || "Loading…"}</p>
    {:else}
      <header class="head">
        <h1>Chat with {thread.agent}</h1>
        <div class="head-actions">
          {#if saved}<span class="muted">Saved · <a href={`/?note=${saved.id}`}>open note</a></span>{:else}<Button variant="ghost" onclick={() => void save()} disabled={messages.length === 0}>Save as note</Button>{/if}
          <Menu label="More actions for this chat" items={[{ label: "Delete chat", danger: true, onselect: () => (confirmDelete = true) }]}>
            {#snippet trigger({ props })}
              <IconButton label="More actions for this chat" {...props}><Ellipsis size={16} strokeWidth={1.5} /></IconButton>
            {/snippet}
          </Menu>
        </div>
      </header>

      {#each modelWarnings as w (w)}<p class="warn" role="note">{w}</p>{/each}

      <div class="messages" bind:this={scroller} aria-live="polite">
        {#each messages as m (m.seq)}
          <article class="msg" class:user={m.role === "user"} class:err={m.role === "error"}>
            <span class="speaker" class:agent={m.role !== "user" && m.role !== "error"}>{speakerOf(m.role, thread.agent)}</span>
            <p class="text">{m.content}</p>
            {#if m.runId && m.role !== "user"}<a class="how" href={`/runs/${encodeURIComponent(m.runId)}`}>How it worked</a>{/if}
          </article>
        {/each}
        {#if live}
          {#each live.tools as tool, i (i)}<p class="tool">{tool}(…)</p>{/each}
          {#if live.text}
            <article class="msg"><span class="speaker agent">{thread.agent}</span><p class="text">{live.text}</p></article>
          {:else if streaming}
            <p class="tool">thinking…</p>
          {/if}
          {#if live.error}<p class="err-line" role="alert">{live.error}</p>{/if}
        {/if}
        {#if waiting}
          <p class="muted">Waiting for your approval in <a href="/approvals">Approvals</a>. The reply appears here after you decide.</p>
        {/if}
      </div>

      {#if error}<p class="err-line" role="alert">{error}</p>{/if}
      <form class="composer" onsubmit={(e) => (e.preventDefault(), void send())}>
        <Textarea bind:el={box} bind:value={draft} onkeydown={onKey} rows={2} placeholder={notConfigured || "Message"} aria-label="Message" disabled={Boolean(notConfigured) || waiting} />
        {#if streaming}
          <Button onclick={stop}>Stop</Button>
        {:else}
          <Button variant="primary" type="submit" disabled={draft.trim() === "" || Boolean(notConfigured) || waiting}>Send</Button>
        {/if}
      </form>
    {/if}
  </section>
</div>

<Dialog bind:open={picking} title="New chat">
  <form id="pick-form" onsubmit={(e) => (e.preventDefault(), void startChat())}>
    <Field label="Which agent?">
      {#snippet children({ id })}
        <Select {id} bind:value={pickAgent}>{#each agents as a (a)}<option value={a}>{a}</option>{/each}</Select>
      {/snippet}
    </Field>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (picking = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="pick-form">Start chat</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmDelete} title="Delete this chat?" description="The conversation is removed. Notes an agent wrote in it stay.">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Keep it</Button>
    <Button variant="danger" onclick={() => void remove()}>Delete chat</Button>
  {/snippet}
</Dialog>

<style>
  .chat {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
    min-height: 0;
  }

  .threads {
    overflow-y: auto;
    box-shadow: inset -1px 0 0 var(--line-soft);
  }

  .threads-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-3) var(--s-2) var(--s-4);
  }

  h2,
  h1 {
    margin: 0;
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  .thread-list {
    padding: 0 var(--s-2) var(--s-4);
  }

  .muted {
    margin: 0;
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .pad {
    padding: 0 var(--s-4) var(--s-3);
  }

  .conversation {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .blank {
    margin: auto;
    max-width: 28rem;
    padding: var(--s-4);
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-3) var(--s-6);
  }

  .head-actions {
    display: flex;
    gap: var(--s-1);
    align-items: center;
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--s-4) var(--s-6);
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
  }

  .msg {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    max-width: var(--measure);
  }

  .speaker {
    color: var(--text-3);
    font: var(--weight-medium) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .speaker.agent {
    color: var(--agent);
  }

  .text {
    margin: 0;
    font: var(--weight-regular) var(--type-body-size) / var(--type-body-lh) var(--font-prose);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Your own messages sit in a soft fill; the agent's read as plain text on the page. */
  .msg.user .text {
    align-self: flex-start;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-surface);
    background: var(--fill-selected);
  }

  .msg.err .text {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-code);
  }

  .how {
    align-self: flex-start;
    color: var(--text-3);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-ui);
  }

  .tool {
    margin: 0;
    color: var(--text-3);
    font: var(--weight-regular) var(--type-meta-size) / var(--type-meta-lh) var(--font-code);
  }

  .err-line {
    margin: 0;
    padding: 0 var(--s-6);
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .warn {
    margin: 0 var(--s-6);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-control);
    background: var(--danger-fill);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .composer {
    display: flex;
    gap: var(--s-3);
    align-items: flex-end;
    padding: var(--s-3) var(--s-6) var(--s-4);
  }

  @media (max-width: 800px) {
    .chat {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
    .threads {
      max-height: 30vh;
      box-shadow: inset 0 -1px 0 var(--line-soft);
    }
  }
</style>
