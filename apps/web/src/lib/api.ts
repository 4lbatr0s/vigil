import type { Note } from "@vigil/shared";

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = (await res.json()) as Envelope<T>;
  if ("error" in payload) throw new Error(`${payload.error.code}: ${payload.error.message}`);
  return payload.data;
}

export const listNotes = () => request<Note[]>("/api/notes");
export const getNote = (id: string) => request<Note>(`/api/notes/${id}`);
export const putNote = (id: string, input: { title: string; body: string }) =>
  request<Note>(`/api/notes/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
export const searchNotes = (q: string) =>
  request<Array<{ id: string; title: string; snippet: string }>>(
    `/api/search?q=${encodeURIComponent(q)}`,
  );
