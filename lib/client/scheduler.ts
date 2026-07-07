// Fires `callback` at a precise wall-clock instant. Plain setTimeout drifts
// (background-tab throttling, imprecise timer coalescing), so for the last
// stretch before the target we poll via requestAnimationFrame, which tracks
// the actual render clock far more tightly than a long setTimeout would.
export function scheduleAtPreciseTime(targetEpochMs: number, callback: () => void): () => void {
  let cancelled = false;
  let rafHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const FINAL_STRETCH_MS = 200;

  function poll() {
    if (cancelled) return;
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) {
      callback();
      return;
    }
    rafHandle = requestAnimationFrame(poll);
  }

  function arm() {
    const remaining = targetEpochMs - Date.now();
    if (remaining <= FINAL_STRETCH_MS) {
      poll();
      return;
    }
    timeoutHandle = setTimeout(arm, remaining - FINAL_STRETCH_MS);
  }

  arm();

  return () => {
    cancelled = true;
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  };
}
