<script lang="ts">
  import { Page, Row, Stack } from "$lib/ui";
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

<Page title="Tools">
  <Stack gap={8}>
    {#each groups as g (g.title)}
      <section aria-labelledby={`g-${g.title}`}>
        <h2 id={`g-${g.title}`}>{g.title}</h2>
        <div class="list">
          {#each g.tools as t (t.href)}
            <Row title={t.title} snippet={t.text} href={t.href} wrap />
          {/each}
        </div>
      </section>
    {/each}
  </Stack>
</Page>

<style>
  h2 {
    margin: 0 0 var(--s-2);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  .list {
    margin: 0 calc(var(--s-3) * -1);
  }
</style>
