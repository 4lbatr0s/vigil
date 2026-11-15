import { PermissionSettingsSchema, type Agent, type PermissionSettings, type ToolGrant } from "@vigil/shared";
import { getSetting, putSetting } from "./state-db";

const KEY = "permissions";

/** Stored settings filled with defaults. A missing or unreadable row gives the safe defaults. */
export function getPermissions(): PermissionSettings {
  const parsed = PermissionSettingsSchema.safeParse(getSetting(KEY) ?? {});
  return parsed.success ? parsed.data : PermissionSettingsSchema.parse({});
}

export function putPermissions(settings: PermissionSettings): PermissionSettings {
  putSetting(KEY, settings);
  return settings;
}

/** A grant works only if the agent has it AND the instance switch is on. */
export function effectiveGrants(agent: Pick<Agent, "tools">, settings: PermissionSettings): ToolGrant[] {
  return agent.tools.filter((grant) => settings.tools[grant]);
}

/** The per-run token cap: the agent's own budget, clamped by the instance maximum. */
export function effectiveBudget(agent: Pick<Agent, "tokenBudget">, settings: PermissionSettings): number {
  return Math.min(agent.tokenBudget, settings.maxTokenBudget);
}

/** The agent as a run actually sees it. Changes affect runs that start afterwards only. */
export function effectiveAgent(agent: Agent, settings: PermissionSettings = getPermissions()): Agent {
  return { ...agent, tools: effectiveGrants(agent, settings), tokenBudget: effectiveBudget(agent, settings) };
}
