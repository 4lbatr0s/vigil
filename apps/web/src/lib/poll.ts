/**
 * Calls `fn` now and then every `ms` while the tab is visible. Hidden tabs do nothing; coming back
 * calls `fn` once at once. Returns a stop function. Errors from `fn` are the caller's to handle.
 */
export function visiblePoll(fn: () => void | Promise<void>, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const run = (): void => {
    void fn();
  };
  const start = (): void => {
    if (timer === null) timer = setInterval(run, ms);
  };
  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      run();
      start();
    } else {
      stop();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (document.visibilityState === "visible") {
    run();
    start();
  }
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
