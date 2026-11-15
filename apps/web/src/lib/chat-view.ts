import type { ChatLine, ChatMessage } from "./api";

/** What the conversation view shows for a turn that is streaming right now. */
export type Live = {
  /** Reply text so far (a model call can answer more than once in a turn when it uses tools). */
  text: string;
  /** Tool activity, one short line each, e.g. "read_note". */
  tools: string[];
  waitingForApproval: boolean;
  error: string | null;
  done: boolean;
};

export const emptyLive = (): Live => ({ text: "", tools: [], waitingForApproval: false, error: null, done: false });

/** Folds one streamed line into the live state. Pure. */
export function applyLine(live: Live, line: ChatLine): Live {
  switch (line.type) {
    case "token":
      return { ...live, text: live.text === "" ? line.text : `${live.text}\n\n${line.text}` };
    case "tool":
      return line.status === "call" ? { ...live, tools: [...live.tools, line.name] } : live;
    case "approval":
      return { ...live, waitingForApproval: true };
    case "error":
      return { ...live, error: line.message };
    case "done":
      return { ...live, done: true };
    default:
      return live;
  }
}

/** The speaker label above a message: "You", the agent's name, or "Error". */
export function speakerOf(role: ChatMessage["role"], agent: string): string {
  return role === "user" ? "You" : role === "assistant" ? agent : "Error";
}

/** A thread is waiting for the owner when its last message is the user's and no run is going (the reply comes after approval). */
export function lastIsUser(messages: ChatMessage[]): boolean {
  return messages.at(-1)?.role === "user";
}
