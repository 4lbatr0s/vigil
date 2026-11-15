<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getSession, login } from "$lib/api";
  import { loginMessage, safeNext } from "$lib/login";

  let token = $state("");
  let error = $state("");
  let busy = $state(false);
  let input = $state<HTMLInputElement | null>(null);

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
  <p class="muted">Enter your access token.</p>
  <form onsubmit={submit}>
    <label>
      <span class="label">Access token</span>
      <input bind:this={input} bind:value={token} type="password" autocomplete="current-password" aria-describedby="login-error" />
    </label>
    {#if error}<p id="login-error" class="error" role="alert">{error}</p>{/if}
    <button type="submit" class="primary" disabled={busy || token === ""}>Sign in</button>
  </form>
</main>

<style>
  .login {
    max-width: 360px;
    margin: 20vh auto 0;
    padding: 0 var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-h2);
    font-weight: 600;
  }
  .muted {
    color: var(--ink-muted);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  .label {
    display: block;
    color: var(--ink-muted);
    font-size: var(--text-label);
    margin-bottom: var(--space-1);
  }
  input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-ui);
  }
  .error {
    color: var(--err-ink);
    font-size: var(--text-label);
  }
  .primary {
    justify-self: start;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--bg);
    font-size: var(--text-label);
  }
  .primary:disabled {
    opacity: 0.5;
  }
</style>
