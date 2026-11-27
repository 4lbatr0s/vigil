import { createHash } from "node:crypto";
import type { Agent } from "@vigil/shared";

/**
 * Everything that shapes how an agent behaves apart from the model's own weights: instructions, tools, limits, hosts, who it
 * may call, its model and whether it asks before writing. Name, description, trigger and test tasks are left out: they do not
 * change what a run does.
 */
export function harnessConfig(agent: Agent): Record<string, unknown> {
  return {
    systemPrompt: agent.systemPrompt,
    archetypeHint: agent.archetypeHint ?? null,
    tools: [...agent.tools].sort(),
    tokenBudget: agent.tokenBudget,
    strict: agent.strict,
    model: agent.model ?? null,
    connection: agent.connection ?? null,
    allowedHosts: [...agent.allowedHosts].sort(),
    callable: [...agent.callable].sort(),
    keepState: agent.keepState === true,
    // Added only when set, so the fingerprint of an agent without a scope stays what it was.
    ...(agent.writeTags !== undefined && agent.writeTags.length > 0 ? { writeTags: [...agent.writeTags].sort() } : {}),
    ...(agent.autoApproveAppends === true ? { autoApproveAppends: true } : {}),
  };
}

/** A short fingerprint of `harnessConfig`: the same setup gives the same eight characters, any change gives new ones. */
export function configVersion(agent: Agent): string {
  return createHash("sha256").update(JSON.stringify(harnessConfig(agent))).digest("hex").slice(0, 8);
}
