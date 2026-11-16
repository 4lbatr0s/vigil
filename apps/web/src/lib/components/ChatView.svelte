<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    ApiError,
    createChat,
    deleteChat,
    getChat,
    getLlmStatus,
    listAgents,
    listChats,
    saveChat,
    streamTurn,
    type ChatMessage,
    type ChatThread,
  } from "$lib/api";
  import { takeDraft } from "$lib/chat-draft";
  import { applyLine, emptyLive, lastIsUser, speakerOf, type Live } from "$lib/chat-view";
  import { agoText } from "$lib/format";
  import { refreshOnLive } from "$lib/live";

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
  let box = $state<HTMLTextAreaElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);

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
      {#if !picking}
        <button type="button" class="act" onclick={() => (picking = true)} disabled={agents.length === 0}>New chat</button>
      {:else}
        <form class="pick" onsubmit={(e) => (e.preventDefault(), void startChat())}>
          <label>
            <span class="muted">Which agent?</span>
            <select bind:value={pickAgent}>{#each agents as a (a)}<option value={a}>{a}</option>{/each}</select>
          </label>
          <div class="row"><button type="submit" class="act primary">Start</button><button type="button" class="act" onclick={() => (picking = false)}>Cancel</button></div>
        </form>
      {/if}
      {#if agents.length === 0}<p class="muted small">Add an agent first.</p>{/if}
    </div>
    <ul>
      {#each threads as t (t.id)}
        <li>
          <a class="thread" class:active={t.id === id} href={`/chat/${t.id}`}>
            <span class="t-title">{t.title}</span>
            <span class="t-meta">{t.agent} · {agoText(t.updatedAt)}</span>
          </a>
        </li>
      {/each}
    </ul>
  </aside>

  <section class="conversation" aria-label="Conversation">
    {#if !id}
      <p class="empty">Pick a chat, or start a new one with an agent.</p>
    {:else if !thread}
      <p class="empty muted">{error || "Loading…"}</p>
    {:else}
      <header class="head">
        <h1>Chat with {thread.agent}</h1>
        <div class="head-actions">
          {#if saved}<span class="muted">Saved · <a href={`/?note=${saved.id}`}>open note</a></span>{:else}<button type="button" class="act" onclick={() => void save()} disabled={messages.length === 0}>Save as note</button>{/if}
          {#if !confirmDelete}
            <button type="button" class="act" onclick={() => (confirmDelete = true)}>Delete</button>
          {:else}
            <span class="muted">Delete this chat?</span>
            <button type="button" class="act danger" onclick={() => void remove()}>Delete</button>
            <button type="button" class="act" onclick={() => (confirmDelete = false)}>Keep</button>
          {/if}
        </div>
      </header>

      <div class="messages" bind:this={scroller} aria-live="polite">
        {#each messages as m (m.seq)}
          <article class="msg" class:err={m.role === "error"}>
            <span class="speaker">{speakerOf(m.role, thread.agent)}</span>
            <p class="text">{m.content}</p>
          </article>
        {/each}
        {#if live}
          {#each live.tools as tool, i (i)}<p class="tool">{tool}(…)</p>{/each}
          {#if live.text}
            <article class="msg"><span class="speaker">{thread.agent}</span><p class="text">{live.text}</p></article>
          {:else if streaming}
            <p class="tool">thinking…</p>
          {/if}
          {#if live.error}<p class="err-line" role="alert">{live.error}</p>{/if}
        {/if}
        {#if waiting}
          <p class="notice">Waiting for your approval in <a href="/approvals">Approvals</a>. The reply will appear here after you decide.</p>
        {/if}
      </div>

      {#if error}<p class="err-line" role="alert">{error}</p>{/if}
      <form class="composer" onsubmit={(e) => (e.preventDefault(), void send())}>
        <textarea
          bind:this={box}
          bind:value={draft}
          onkeydown={onKey}
          rows="2"
          placeholder={notConfigured || "Message"}
          aria-label="Message"
          disabled={Boolean(notConfigured) || waiting}
        ></textarea>
        {#if streaming}
          <button type="button" class="act" onclick={stop}>Stop</button>
        {:else}
          <button type="submit" class="act primary" disabled={draft.trim() === "" || Boolean(notConfigured) || waiting}>Send</button>
        {/if}
      </form>
      {#if notConfigured}<p class="muted small pad">{notConfigured}</p>{/if}
    {/if}
  </section>
</div>

<style>
  .chat {
    display: grid;
    grid-template-columns: 260px 1fr;
    height: 100%;
    min-height: 0;
  }
  .threads {
    border-right: 1px solid var(--hairline);
    overflow-y: auto;
  }
  .threads-head {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--hairline);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .thread {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--hairline);
    border-left: 2px solid transparent;
    text-decoration: none;
  }
  .thread.active {
    border-left-color: var(--ink);
    background: var(--surface);
  }
  .t-title {
    font-family: var(--font-serif);
    font-size: var(--text-ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t-meta,
  .muted {
    color: var(--ink-muted);
  }
  .t-meta {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .small {
    font-size: var(--text-label);
  }
  .pad {
    padding: 0 var(--space-6) var(--space-3);
  }
  .conversation {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .empty {
    margin: auto;
    color: var(--ink-muted);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--hairline);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h3);
    font-weight: 600;
  }
  .head-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    font-size: var(--text-label);
  }
  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-6);
    display: grid;
    align-content: start;
    gap: var(--space-4);
  }
  .msg {
    max-width: var(--measure);
    display: grid;
    gap: var(--space-1);
  }
  .speaker {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .text {
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .msg.err .text {
    color: var(--err-ink);
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }
  .tool {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .err-line {
    color: var(--err-ink);
    font-size: var(--text-label);
    padding: 0 var(--space-6);
  }
  .notice {
    font-size: var(--text-label);
    color: var(--ink-muted);
  }
  .composer {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    padding: var(--space-3) var(--space-6);
    border-top: 1px solid var(--hairline);
  }
  textarea {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: var(--font-serif);
    font-size: var(--text-ui);
    resize: vertical;
  }
  select {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    width: 100%;
  }
  .pick {
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-label);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .act {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-label);
  }
  .act.primary {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }
  .act.danger {
    border-color: var(--err);
    color: var(--err-ink);
  }
  .act:disabled {
    opacity: 0.5;
  }
  @media (max-width: 800px) {
    .chat {
      grid-template-columns: 1fr;
    }
    .threads {
      max-height: 30vh;
    }
  }
</style>
