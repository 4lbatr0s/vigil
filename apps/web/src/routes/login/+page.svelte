<script lang="ts">
  import { Button, Field, Input } from "$lib/ui";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getSession, login } from "$lib/api";
  import { loginMessage, safeNext } from "$lib/login";

  let token = $state("");
  let error = $state("");
  let busy = $state(false);
  let input = $state<HTMLInputElement | undefined>();

  const next = $derived(safeNext(page.url.searchParams.get("next")));

  onMount(() => {
    input?.focus();
    // Already signed in (or no login needed): nothing to do here.
    void getSession()
      .then((s) => {
        if (s.authenticated) void goto(next, { replaceState: true });
      })
      .catch(() => undefined);
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || token === "") return;
    busy = true;
    error = "";
    try {
      await login(token);
      token = "";
      await goto(next, { replaceState: true });
    } catch (err) {
      error = loginMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in · Vigil</title></svelte:head>

<main class="login">
  <h1>Vigil</h1>
  <form onsubmit={submit}>
    <Field label="Access token" error={error || undefined}>
      {#snippet children({ id, describedby, invalid })}
        <Input {id} bind:el={input} bind:value={token} type="password" autocomplete="current-password" aria-describedby={describedby} {invalid} />
      {/snippet}
    </Field>
    <div><Button variant="primary" type="submit" disabled={busy || token === ""}>Sign in</Button></div>
  </form>
</main>

<style>
  .login {
    display: flex;
    flex-direction: column;
    gap: var(--s-6);
    max-width: 360px;
    margin: 20vh auto 0;
    padding: 0 var(--s-4);
    color: var(--text);
  }

  h1 {
    margin: 0;
    font: var(--weight-strong) var(--type-title-size) / var(--type-title-lh) var(--font-ui);
    letter-spacing: var(--type-title-tracking);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
</style>
