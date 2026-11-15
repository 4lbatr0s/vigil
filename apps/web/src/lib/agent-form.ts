import type { Agent, PermissionSettings, ToolGrant } from "@vigil/shared";

/** What the agent page edits. Strings stay strings until saved, so a half-typed number is not lost. */
export type AgentForm = {
  description: string;
  systemPrompt: string;
  enabled: boolean;
  strict: boolean;
  tokenBudget: string;
  model: string;
};

export function agentToForm(agent: Agent): AgentForm {
  return {
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    strict: agent.strict,
    tokenBudget: String(agent.tokenBudget),
    model: agent.model ?? "",
  };
}

/**
 * The whole definition to PUT: the loaded agent with the form's edits laid over it. Fields the form
 * does not know (trigger, tools, hosts, callable, defaultTask) are carried over untouched, and an
 * empty model is left out rather than sent as an empty string.
 */
export function formToAgent(base: Agent, form: AgentForm): Agent {
  const { model: _drop, ...rest } = base;
  const model = form.model.trim();
  return {
    ...rest,
    description: form.description,
    systemPrompt: form.systemPrompt,
    enabled: form.enabled,
    strict: form.strict,
    tokenBudget: form.tokenBudget.trim() === "" ? Number.NaN : Number(form.tokenBudget),
    ...(model === "" ? {} : { model }),
  };
}

export type GrantLine = { tool: ToolGrant; text: string; blocked: boolean };

/** Plain-English permission lines for the Turn on panel; `blocked` when an instance switch is off. */
export function describeGrants(agent: Agent, settings: PermissionSettings): GrantLine[] {
  const text: Record<ToolGrant, string> = {
    read_notes: "Can read your notes.",
    write_notes: "Can write notes: every write is saved first so you can undo.",
    web_fetch: agent.allowedHosts.length > 0 ? `Can fetch web pages from: ${agent.allowedHosts.join(", ")}.` : "Can fetch web pages, but no sites are allowed yet.",
    call_agents: agent.callable.length > 0 ? `Can start these agents: ${agent.callable.join(", ")}.` : "Can start other agents, but none are chosen yet.",
  };
  return agent.tools.map((tool) => ({ tool, text: text[tool], blocked: !settings.tools[tool] }));
}

/** True when the agent can both read notes and fetch the web with approvals off: the combination ADR-0006 warns about. */
export function riskyCombination(agent: Pick<Agent, "tools" | "strict">): boolean {
  return agent.tools.includes("read_notes") && agent.tools.includes("web_fetch") && !agent.strict;
}
