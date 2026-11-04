// Local timing only. No tracking request, transcript or inference of emotions.
const OFFERED_KEY = 'posi-assistance-offered-v2';
export function createAttentionPolicy({ now = Date.now, storage, dwellMs = 60000, idleMs = 25000 } = {}) {
  const dwell = Number.isFinite(dwellMs) ? Math.max(60000, dwellMs) : 60000;
  const idle = Number.isFinite(idleMs) ? Math.max(25000, idleMs) : 25000;
  let last = now(), lastProgress = last, visibleMs = 0, active = true, offered = false;
  try { offered = storage?.getItem(OFFERED_KEY) === '1'; } catch { /* Storage is optional. */ }
  function advance(visible = true) {
    const current = now();
    // visibilitychange updates active before a background interval is counted.
    if (active && visible) visibleMs += Math.max(0, current - last);
    last = current; active = visible;
  }
  return {
    progress() { lastProgress = now(); },
    visibility(visible) { advance(active); active = Boolean(visible); last = now(); lastProgress = last; },
    eligible({ visible = true, blocked = false, completed = false } = {}) {
      advance(visible);
      return !offered && visible && !blocked && !completed && visibleMs >= dwell && now() - lastProgress >= idle;
    },
    markOffered() { offered = true; try { storage?.setItem(OFFERED_KEY, '1'); } catch { /* No storage dependency. */ } },
    get offered() { return offered; },
  };
}
