import type { PermissionSettings } from "@vigil/shared";
import type { LlmStatus, Usage } from "./api";

export type SettingsForm = {
  tools: PermissionSettings["tools"];
  newAgentsStrict: boolean;
  maxTokenBudget: string;
  retentionDays: string;
};

export function settingsToForm(s: PermissionSettings): SettingsForm {
  return { tools: { ...s.tools }, newAgentsStrict: s.newAgentsStrict, maxTokenBudget: String(s.maxTokenBudget), retentionDays: String(s.retentionDays) };
}

/** Numbers stay strings in the form; a blank or non-number becomes NaN so the server's message appears. */
export function formToSettings(f: SettingsForm): PermissionSettings {
  const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));
  return { tools: { ...f.tools }, newAgentsStrict: f.newAgentsStrict, maxTokenBudget: num(f.maxTokenBudget), retentionDays: num(f.retentionDays) };
}

export type SettingsField = "maxTokenBudget" | "retentionDays" | "tools" | "newAgentsStrict";

/** Which input a server message ("Invalid settings: retentionDays: ...") belongs under, if it says. */
export function fieldOfError(detail: string): SettingsField | null {
  const m = /^Invalid settings: (maxTokenBudget|retentionDays|tools|newAgentsStrict)\b/.exec(detail);
  return m ? (m[1] as SettingsField) : null;
}

/** The text after the field path, for showing under the input. */
export function messageOfError(detail: string): string {
  return detail.replace(/^Invalid settings: (?:[A-Za-z.]+: )?/, "");
}

export type Banner = { text: string; href: string };

/** One plain banner for every page, or null. Model trouble outranks usage. */
export function bannerFor(llm: LlmStatus | null, usage: Usage | null): Banner | null {
  if (llm && (llm.model === null || (llm.provider !== "ollama" && !llm.hasKey))) {
    return { text: "No AI model is set up yet, so agents cannot run. Open Settings to see what to set.", href: "/settings" };
  }
  if (usage && usage.level === "over") {
    return { text: `This month's agent usage passed your cap (${usage.tokens.toLocaleString("en")} of ${usage.cap?.toLocaleString("en")} tokens). Agents still run.`, href: "/settings" };
  }
  if (usage && usage.level === "warn") {
    return { text: `This month's agent usage is above 80% of your cap (${usage.tokens.toLocaleString("en")} of ${usage.cap?.toLocaleString("en")} tokens).`, href: "/settings" };
  }
  return null;
}
