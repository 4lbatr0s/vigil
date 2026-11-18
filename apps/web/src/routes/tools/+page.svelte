<script lang="ts">
  type Tool = { href: string; title: string; text: string };
  type Group = { title: string; tools: Tool[] };

  const groups: Group[] = [
    {
      title: "Understand your notes",
      tools: [
        { href: "/ask", title: "Ask your notes", text: "Ask a question and get an answer built only from your own note lines, each claim pointing at the line behind it." },
        { href: "/gap", title: "Gap check", text: "Paste an article or transcript and see what your notes already have, what is missing and what disagrees." },
        { href: "/graph", title: "Graph", text: "The whole vault as a map of links, or colored by how much of each note you remember." },
      ],
    },
    {
      title: "Practise what you wrote",
      tools: [
        { href: "/recall", title: "Recall", text: "Write what you remember of a note, then see what you covered and missed. Notes come back after 1, 3, 7 and 21 days." },
        { href: "/outline", title: "Study outline", text: "Paste text and get headings with a question each, answers left empty for you to write." },
        { href: "/study", title: "Study cards", text: "Review the cards in your notes at the pace that suits when you remember them." },
      ],
    },
    {
      title: "Bring things in",
      tools: [
        { href: "/capture", title: "Capture", text: "Add a thought or a link to your Inbox note." },
        { href: "/import", title: "Import cards", text: "Turn an Anki plain-text export into a note of cards." },
      ],
    },
  ];
</script>

<svelte:head><title>Tools · Vigil</title></svelte:head>

<main class="page">
  <h1>Tools</h1>
  <p class="muted">Helpers that work with your notes. Each one tells you what it will read before it runs.</p>
  {#each groups as g (g.title)}
    <section aria-labelledby={`g-${g.title}`}>
      <h2 id={`g-${g.title}`}>{g.title}</h2>
      <ul>
        {#each g.tools as t (t.href)}
          <li>
            <a href={t.href}>
              <strong>{t.title}</strong>
              <span>{t.text}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</main>

<style>
  .page {
    padding: var(--space-6);
    max-width: 820px;
    margin-inline: auto;
    display: grid;
    gap: var(--space-4);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
  }
  h2 {
    font-size: var(--text-ui);
    font-weight: 600;
    color: var(--ink-muted);
    margin-bottom: var(--space-2);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-3);
  }
  li a {
    display: grid;
    gap: var(--space-1);
    height: 100%;
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    color: var(--ink);
    text-decoration: none;
  }
  li a:hover {
    background: var(--surface-hover);
  }
  li span {
    color: var(--ink-muted);
    font-size: var(--text-label);
  }
</style>
