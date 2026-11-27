import type { ChatModel } from "./llm";

/** Waits between tries; the last step repeats if there are more tries than steps. */
export const DEFAULT_BACKOFF_MS = [500, 1500];
export const MAX_ATTEMPTS = 3;
/** A server's Retry-After is honoured up to this long; a longer wait is not worth a held-open run. */
const MAX_RETRY_AFTER_MS = 10_000;

type ErrorLike = { status?: unknown; code?: unknown; message?: unknown; cause?: unknown; headers?: unknown; response?: { status?: unknown; headers?: unknown } };

const asLike = (err: unknown): ErrorLike | null => (typeof err === "object" && err !== null ? (err as ErrorLike) : null);

function statusOf(err: ErrorLike): number | null {
  const s = err.status ?? err.response?.status;
  return typeof s === "number" ? s : null;
}

function codeOf(err: ErrorLike): string | null {
  const own = typeof err.code === "string" ? err.code : null;
  const cause = asLike(err.cause);
  return own ?? (cause && typeof cause.code === "string" ? cause.code : null);
}

/**
 * True for a failure that a second try can fix: rate limits, server errors, and connections that dropped part of the
 * way. A client error (a wrong key, a bad request), a model that cannot do something (501) and a server that is not
 * running (ECONNREFUSED) are not retried: waiting changes nothing and the person should see the error at once.
 */
export function isRetryable(err: unknown): boolean {
  const e = asLike(err);
  if (!e) return false;
  const status = statusOf(e);
  if (status !== null) return status === 429 || (status >= 500 && status <= 599 && status !== 501);
  const code = codeOf(e);
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE" || code === "UND_ERR_SOCKET") return true;
  return typeof e.message === "string" && /^terminated$/i.test(e.message);
}

function headerValue(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (typeof headers === "object" && headers !== null) {
    const v = (headers as Record<string, unknown>)[name];
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** How long to wait before try number `attempt + 2` (`attempt` counts from 0): Retry-After when sent, else the backoff step. */
export function retryDelayMs(err: unknown, attempt: number, backoff: number[] = DEFAULT_BACKOFF_MS): number {
  const step = backoff[Math.min(attempt, backoff.length - 1)] ?? 500;
  const e = asLike(err);
  const raw = e ? (headerValue(e.headers, "retry-after") ?? headerValue(e.response?.headers, "retry-after")) : null;
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : step;
}

export type RetryOptions = {
  attempts?: number;
  backoffMs?: number[];
  /** Called before each retry with the number of the retry (1, 2, ...). */
  onRetry?: (retry: number, err: unknown) => void;
  /** Cancelling the run stops the waiting and the retrying at once. */
  signal?: AbortSignal | undefined;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt<T>(run: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = opts.attempts ?? MAX_ATTEMPTS;
  const sleep = opts.sleep ?? realSleep;
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i + 1 >= attempts || !isRetryable(err) || opts.signal?.aborted) throw err;
      opts.onRetry?.(i + 1, err);
      await sleep(retryDelayMs(err, i, opts.backoffMs));
      if (opts.signal?.aborted) throw err;
    }
  }
}

/**
 * The same model with retries around each call. For streaming only the call that opens the stream is retried: once
 * words have been shown to the person, starting over would repeat them.
 */
export function withRetry(model: ChatModel, opts: RetryOptions = {}): ChatModel {
  const stream = model.stream?.bind(model);
  return {
    invoke: (messages) => attempt(() => model.invoke(messages), opts),
    ...(stream ? { stream: (messages: Parameters<NonNullable<ChatModel["stream"]>>[0], options?: Parameters<NonNullable<ChatModel["stream"]>>[1]) => attempt(() => stream(messages, options), opts) } : {}),
  };
}
