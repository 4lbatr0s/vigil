import { EditorView } from "@codemirror/view";

/** Images are stored in the vault as `attachments/<16 hex>.<ext>` (ADR-0021) and linked with a relative path. */
const ATTACHMENT = /^attachments\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))$/;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function imageMarkdown(name: string, alt = ""): string {
  return `![${alt.replace(/[[\]]/g, "")}](attachments/${name})`;
}

/** The address the app serves a vault image from, or null when the link is not one of ours. */
export function attachmentSrc(url: string): string | null {
  const m = ATTACHMENT.exec(url.trim());
  return m ? `/api/attachments/${m[1]}` : null;
}

const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The image files in a paste or drop (screenshots and dragged pictures), in order. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => ALLOWED.has(f.type));
}

/** A readable reason when a file cannot be added, or null when it can. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!ALLOWED.has(file.type)) return "Only PNG, JPEG, GIF and WebP images can be added.";
  if (file.size > MAX_IMAGE_BYTES) return "That image is over 5 MB. Shrink it first.";
  return null;
}

/**
 * Paste or drop a picture into the note: it is uploaded and a markdown image line is put at the cursor.
 * Text pastes are left alone. `onProblem` gets a short message when an image cannot be added.
 */
export function imageDrop(upload: (file: File) => Promise<string>, onProblem: (message: string) => void) {
  const handle = (view: EditorView, data: DataTransfer | null, event: Event): boolean => {
    const files = imageFiles(data);
    if (files.length === 0) return false;
    event.preventDefault();
    void (async () => {
      for (const file of files) {
        const problem = imageProblem(file);
        if (problem) {
          onProblem(problem);
          continue;
        }
        try {
          const name = await upload(file);
          const at = view.state.selection.main.head;
          const line = view.state.doc.lineAt(at);
          const lead = line.text.trim() === "" ? "" : "\n";
          const insert = `${lead}${imageMarkdown(name)}\n`;
          view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
        } catch (err) {
          onProblem(err instanceof Error ? err.message : "Could not add the image.");
        }
      }
    })();
    return true;
  };
  return EditorView.domEventHandlers({
    paste: (event, view) => handle(view, event.clipboardData, event),
    drop: (event, view) => handle(view, event.dataTransfer, event),
  });
}
