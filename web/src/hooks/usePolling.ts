import { useEffect, useRef } from "preact/hooks";

// Recursive scheduling prevents overlapping requests. Dependencies replace the
// whole lifecycle; changing callback identities alone does not restart a poll.
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  nextDelay: (result: T | undefined, error?: unknown) => number | null,
  deps: readonly unknown[],
  { startDelay = 0 }: { startDelay?: number } = {},
) {
  const callbacks = useRef({ load, nextDelay });
  callbacks.current = { load, nextDelay };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
      request?.abort();
    };
    const run = async () => {
      if (!live || document.hidden) return;
      const controller = new AbortController();
      request = controller;
      let result: T | undefined;
      let error: unknown;
      try {
        result = await callbacks.current.load(controller.signal);
      } catch (caught) {
        error = caught;
      }
      if (!live || controller.signal.aborted || document.hidden) return;
      const delay = callbacks.current.nextDelay(result, error);
      if (delay !== null) timer = setTimeout(run, delay);
    };
    const visibility = () => {
      stop();
      if (!document.hidden) void run();
    };
    if (!document.hidden) timer = setTimeout(run, startDelay);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, deps);
}
