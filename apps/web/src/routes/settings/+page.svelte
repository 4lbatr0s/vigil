<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import ModelsSettings from "$lib/components/ModelsSettings.svelte";
  import McpSettingsSection from "$lib/components/McpSettings.svelte";
  import MeaningSettings from "$lib/components/MeaningSettings.svelte";
  import TidyPictures from "$lib/components/TidyPictures.svelte";
  import { Button, Cluster, Field, Input, Page, Select, Stack, Switch } from "$lib/ui";
  import StudySettingsSection from "$lib/components/StudySettings.svelte";
  import { ApiError, getPermissions, getSession, getUsage, logout, putPermissions, type Session, type Usage } from "$lib/api";
  import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "$lib/appearance";
  import { fieldOfError, formToSettings, messageOfError, settingsToForm, type SettingsField, type SettingsForm } from "$lib/settings-form";

  let form = $state<SettingsForm | null>(null);
  let saved = $state<SettingsForm | null>(null);
  let usage = $state<Usage | null>(null);
  let session = $state<Session | null>(null);
  let loadError = $state("");
  let saveError = $state<{ field: SettingsField | null; text: string } | null>(null);
  let notice = $state("");
  let busy = $state(false);
  // Appearance lives in this browser only (it is not a server setting).
  let look = $state<Appearance>({ theme: "system", size: "medium" });
  function changeLook(next: Appearance): void {
    look = next;
    saveAppearance(next);
    applyAppearance(next);
  }

  const dirty = $derived(form !== null && saved !== null && JSON.stringify(form) !== JSON.stringify(saved));

  const tools = [
    { key: "read_notes", label: "Agents can read notes", why: "Off: agents see none of your notes, so most of them can do nothing." },
    { key: "write_notes", label: "Agents can write notes", why: "Off: agents can only read. Every write is saved first so you can undo it." },
    { key: "web_fetch", label: "Agents can fetch web pages", why: "Off: no agent reaches the internet, whatever its own settings say." },
    { key: "call_agents", label: "Agents can call other agents", why: "Off: an agent cannot start another one." },
  ] as const;

  onMount(() => {
    look = loadAppearance();
    void (async () => {
      try {
        const [settings, use] = await Promise.all([getPermissions(), getUsage()]);
        form = settingsToForm(settings);
        saved = settingsToForm(settings);
        usage = use;
        session = await getSession();
      } catch (err) {
        loadError = err instanceof Error ? err.message : "Could not load settings";
      }
    })();
  });

  async function save(): Promise<void> {
    if (!form) return;
    busy = true;
    saveError = null;
    notice = "";
    try {
      const out = await putPermissions(formToSettings(form));
      form = settingsToForm(out);
      saved = settingsToForm(out);
      notice = "Saved. Runs that start from now on use these settings.";
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Could not save";
      saveError = { field: fieldOfError(detail), text: messageOfError(detail) };
    } finally {
      busy = false;
    }
  }

  async function signOut(): Promise<void> {
    try {
      await logout();
    } finally {
      await goto("/login");
    }
  }

  const pct = $derived(usage && usage.cap ? Math.min(100, Math.round((usage.tokens / usage.cap) * 100)) : null);
</script>

<svelte:head><title>Settings · Vigil</title></svelte:head>

<Page title="Settings">
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}
  <nav class="jump" aria-label="Jump to a section">
    <Cluster gap={1}>
      <Button variant="ghost" size="sm" href="#models">AI models</Button>
      <Button variant="ghost" size="sm" href="#look">Appearance</Button>
      <Button variant="ghost" size="sm" href="#study-settings">Study</Button>
      <Button variant="ghost" size="sm" href="#mcp-settings">Other agents</Button>
      <Button variant="ghost" size="sm" href="#pictures">Pictures</Button>
      <Button variant="ghost" size="sm" href="#perm">Permissions</Button>
      <Button variant="ghost" size="sm" href="#use">Usage</Button>
    </Cluster>
  </nav>

  <div class="sections">
    <ModelsSettings />

    <section aria-labelledby="look">
      <h2 id="look">Appearance</h2>
      <p class="muted">Kept in this browser only.</p>
      <div class="look">
        <Field label="Theme">
          {#snippet children({ id })}
            <Select {id} value={look.theme} onchange={(e) => changeLook({ ...look, theme: e.currentTarget.value === "light" || e.currentTarget.value === "dark" ? e.currentTarget.value : "system" })}>
              <option value="system">Same as the system</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          {/snippet}
        </Field>
        <Field label="Note text size">
          {#snippet children({ id })}
            <Select {id} value={look.size} onchange={(e) => changeLook({ ...look, size: e.currentTarget.value === "small" || e.currentTarget.value === "large" ? e.currentTarget.value : "medium" })}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </Select>
          {/snippet}
        </Field>
      </div>
    </section>

    <StudySettingsSection />

    <MeaningSettings />

    <McpSettingsSection />
    <TidyPictures />

    {#if form}
      <section aria-labelledby="perm">
        <h2 id="perm">Permissions</h2>
        <p class="muted">What agents may do. A switch that is off wins over any single agent's own settings.</p>
        <Stack gap={4}>
          <Stack gap={3}>
            {#each tools as t (t.key)}
              <div class="setting">
                <Switch label={t.label} bind:checked={form.tools[t.key]} />
                <p class="why">{t.why}</p>
              </div>
            {/each}
            <div class="setting">
              <Switch label="New agents ask for my approval before writing" bind:checked={form.newAgentsStrict} />
              <p class="why">Only sets the starting value for agents you add later. You can change any agent on its own page.</p>
            </div>
          </Stack>

          <Field label="Highest token budget any run may use" error={saveError?.field === "maxTokenBudget" ? saveError.text : undefined}>
            {#snippet children({ id, describedby, invalid })}
              <span class="narrow"><Input {id} aria-describedby={describedby} {invalid} inputmode="numeric" bind:value={form!.maxTokenBudget} /></span>
            {/snippet}
          </Field>
          <Field label="Keep run history for (days, 0 = forever)" hint="After this, run logs and undo copies are removed. Undo is no longer possible for older runs." error={saveError?.field === "retentionDays" ? saveError.text : undefined}>
            {#snippet children({ id, describedby, invalid })}
              <span class="narrow"><Input {id} aria-describedby={describedby} {invalid} inputmode="numeric" bind:value={form!.retentionDays} /></span>
            {/snippet}
          </Field>

          {#if saveError && saveError.field === null}<p class="error" role="alert">{saveError.text}</p>{/if}
          <Cluster gap={3}>
            <Button variant="primary" disabled={busy || !dirty} onclick={() => void save()}>Save changes</Button>
            {#if notice && !dirty}<span class="muted" aria-live="polite">{notice}</span>{/if}
          </Cluster>
        </Stack>
      </section>
    {/if}

    <section aria-labelledby="use">
      <h2 id="use">Usage this month</h2>
      {#if usage}
        <p>{usage.tokens.toLocaleString("en")} tokens{usage.cap ? ` of ${usage.cap.toLocaleString("en")} (${pct}%)` : " (no cap set)"}</p>
        {#if usage.cap}
          <div class="bar" role="img" aria-label={`${pct}% of the monthly cap`}><span class="fill" style:width={`${pct}%`}></span></div>
          <p class="muted">The cap is a warning only. It never stops an agent.</p>
        {/if}
      {/if}
    </section>

    <section aria-labelledby="access">
      <h2 id="access">Access</h2>
      {#if session?.required}
        <Cluster gap={3}><span>Signed in.</span><Button onclick={() => void signOut()}>Sign out</Button></Cluster>
      {:else if session}
        <p class="muted">Local access: no token is set, so there is no login.</p>
      {/if}
    </section>
  </div>
</Page>

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--s-10);
    margin-top: var(--s-6);
  }

  .sections :global(section) {
    scroll-margin-top: var(--s-16);
  }

  /* Every section, including the ones other components draw: the same heading and rhythm. */
  .sections :global(section h2) {
    margin: 0 0 var(--s-1);
    font: var(--weight-strong) var(--type-heading-size) / var(--type-heading-lh) var(--font-ui);
  }

  .sections :global(section > p) {
    margin-bottom: var(--s-3);
  }

  .jump {
    position: sticky;
    top: 0;
    z-index: 2;
    margin: 0 calc(var(--s-2) * -1);
    padding: var(--s-2);
    background: var(--paper);
  }

  p {
    margin: 0;
  }

  .muted,
  .why {
    color: var(--text-2);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .why {
    margin: 0 0 0 calc(36px + var(--s-3));
    font-size: var(--type-meta-size);
    line-height: var(--type-meta-lh);
    color: var(--text-3);
  }

  .error {
    color: var(--danger);
    font: var(--weight-regular) var(--type-ui-size) / var(--type-ui-lh) var(--font-ui);
  }

  .look {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4);
  }

  .look :global(select) {
    min-width: 14rem;
  }

  .narrow {
    display: inline-block;
    width: 8rem;
  }

  .bar {
    height: 4px;
    max-width: 320px;
    margin: var(--s-2) 0;
    border-radius: var(--r-pill);
    background: var(--fill-selected);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: var(--r-pill);
    background: var(--text-2);
  }
</style>
