<script lang="ts">
  import { page } from "$app/state";
  import ChatView from "$lib/components/ChatView.svelte";
</script>

<ChatView id={page.params.id ?? null} />
