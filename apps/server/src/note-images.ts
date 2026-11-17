import { z } from "zod";
import { ATTACHMENT_NAME, readAttachment } from "./attachments";
import { isAppError } from "./errors";
import { getSetting, putSetting } from "./state-db";

/**
 * Pictures in a note, for an agent that is asked to look at them (ADR-0025). Only our own pasted pictures count
 * (`![](attachments/<name>)`): the name must match the attachment pattern, so nothing else on disk or the web is read.
 * Sent only when the owner switched it on, and only to the no-tool study agents, to a model that can see images.
 */

export const MAX_PICTURES = 4;
/** Together they must stay small: five pictures of 5 MB each would flood a model request. */
export const MAX_PICTURE_BYTES_TOTAL = 8 * 1024 * 1024;

export const ImageSettingsSchema = z.object({ agentsSeePictures: z.boolean() });
export type ImageSettings = z.infer<typeof ImageSettingsSchema>;

export function imageSettings(): ImageSettings {
  const parsed = ImageSettingsSchema.safeParse(getSetting("images"));
  return parsed.success ? parsed.data : { agentsSeePictures: false };
}

export function saveImageSettings(next: ImageSettings): ImageSettings {
  putSetting("images", next);
  return next;
}

const LINK = /!\[[^\]]*\]\(attachments\/([^)\s]+)\)/g;

/** Picture file names a note body links to, in order, each once. */
export function pictureNames(body: string): string[] {
  const names: string[] = [];
  for (const m of body.matchAll(LINK)) {
    const name = m[1] ?? "";
    if (ATTACHMENT_NAME.test(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The note's pictures as base64, when the owner allows it. Missing files are skipped; the total is capped. */
export async function picturesFor(body: string): Promise<{ mime: string; data: string }[]> {
  if (!imageSettings().agentsSeePictures) return [];
  const out: { mime: string; data: string }[] = [];
  let total = 0;
  for (const name of pictureNames(body).slice(0, MAX_PICTURES)) {
    try {
      const { bytes, mime } = await readAttachment(name);
      if (total + bytes.length > MAX_PICTURE_BYTES_TOTAL) break;
      total += bytes.length;
      out.push({ mime, data: bytes.toString("base64") });
    } catch (err) {
      // A link to a picture that is gone: the agent just sees the text without it. Anything else is a real problem.
      if (!isAppError(err) || err.code !== "attachment-not-found") throw err;
    }
  }
  return out;
}
