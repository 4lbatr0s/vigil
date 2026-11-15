/**
 * Reads a newline-delimited JSON body and yields one parsed value per line. A line that is not
 * valid JSON throws, because a half-understood stream is worse than a reconnect. Shared by the
 * live event stream and chat streaming.
 */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line !== "") yield parseLine<T>(line);
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest !== "") yield parseLine<T>(rest);
  } finally {
    reader.releaseLock();
  }
}

function parseLine<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new Error("The server sent a line that is not valid JSON");
  }
}
