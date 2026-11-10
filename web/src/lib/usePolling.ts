import { useEffect, useRef } from "react";

/**
 * Calls `fn` every `ms` while the tab is visible, and immediately when it becomes visible again.
 * Skips a tick if the previous call is still running.
 */
export function usePolling(fn: () => Promise<unknown> | void, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await fnRef.current();
      } catch {
        /* surfaced by the caller */
      } finally {
        running = false;
      }
    };
    const id = window.setInterval(tick, ms);
    const onVisible = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}
