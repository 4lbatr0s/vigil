<script lang="ts">
  let { html = "" }: { html?: string } = $props();
</script>

<article class="preview">
  {@html html}
</article>

<style>
  .preview {
    max-width: var(--measure);
    font-family: var(--font-serif);
    font-size: var(--text-prose);
    line-height: 1.6;
    color: var(--ink);
  }

  .preview :global(h1) {
    font-size: var(--text-h1);
    line-height: 1.2;
    font-weight: 600;
    margin-bottom: var(--space-4);
  }

  .preview :global(h2) {
    font-size: var(--text-h2);
    line-height: 1.25;
    font-weight: 600;
    margin: var(--space-6) 0 var(--space-3);
  }

  .preview :global(h3) {
    font-size: var(--text-h3);
    line-height: 1.3;
    font-weight: 600;
    margin: var(--space-4) 0 var(--space-2);
  }

  .preview :global(p) {
    margin-bottom: var(--space-4);
  }

  .preview :global(ul),
  .preview :global(ol) {
    margin: 0 0 var(--space-4) var(--space-4);
  }

  .preview :global(a) {
    color: var(--ink);
    text-decoration: underline;
  }

  .preview :global(code) {
    font-size: var(--text-ui);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 0 var(--space-1);
  }

  .preview :global(pre) {
    font-size: var(--text-ui);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: var(--space-3);
    overflow-x: auto;
    margin-bottom: var(--space-4);
  }

  .preview :global(pre code) {
    background: none;
    border: none;
    padding: 0;
  }

  .preview :global(blockquote) {
    margin: 0 0 var(--space-4);
    padding-left: var(--space-3);
    border-left: 1px solid var(--hairline);
    color: var(--ink-muted);
  }

  .preview :global(hr) {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: var(--space-6) 0;
  }
</style>
