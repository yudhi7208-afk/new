// Optional UI only: never reads forms, waits for AI, or changes order state.
export function popupPlacement(width, height, viewportWidth, viewportHeight, protectedRects = []) {
  const candidates = [
    ['top-right', viewportWidth - width - 12, 108], ['top-left', 12, 108],
    ['bottom-right', viewportWidth - width - 12, viewportHeight - height - 88], ['bottom-left', 12, viewportHeight - height - 88],
  ];
  for (const [name, x, y] of candidates) {
    if (x < 0 || y < 100 || x + width > viewportWidth || y + height > viewportHeight - 12) continue;
    if (protectedRects.some(r => x < r.right + 8 && x + width > r.left - 8 && y < r.bottom + 8 && y + height > r.top - 8)) continue;
    return name;
  }
  return null;
}
try {
  const notice = document.getElementById('posi-service-notice');
  if (notice) {
    const remaining = Number(notice.dataset.remainingMs);
    const deadline = performance.now() + remaining;
    const key = 'posi-posting-notice-popup-2026-11-05';
    let closed = false, context, played = false, expiryTimer, popupTimer, lastPlayed = -Infinity;
    const active = () => !closed && !notice.hidden && !document.hidden && performance.now() < deadline;
    function dismiss() { try { sessionStorage.setItem(key, 'dismissed'); } catch { /* Optional. */ } remove(); }
    function escape(event) { if (event.key === 'Escape' && active()) dismiss(); }
    function outside(event) { if (active() && !notice.contains(event.target)) dismiss(); }
    function position() {
      if (closed) return;
      if (performance.now() >= deadline) { remove(); return; }
      const focused = document.activeElement;
      const dialog = [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"],[data-payment-modal]')].some(el => el !== notice && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
      if (document.hidden || dialog || (!notice.contains(focused) && focused?.matches?.('input,textarea,select,[contenteditable="true"]'))) { notice.hidden = true; return; }
      notice.hidden = false;
      const size = notice.getBoundingClientRect();
      const targets = [...document.querySelectorAll('input,textarea,select,button[type="submit"],#continueButton,#whatsappButton,a[href*="/pembayaran/"]')]
        .filter(el => !notice.contains(el)).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight);
      const placement = popupPlacement(size.width, size.height, document.documentElement.clientWidth, innerHeight, targets);
      if (placement) notice.dataset.placement = placement;
      else { notice.hidden = true; delete notice.dataset.placement; }
    }
    function remove() {
      closed = true; notice.remove();
      clearTimeout(expiryTimer);
      clearInterval(popupTimer);
      document.removeEventListener('pointerdown', firstGesture);
      document.removeEventListener('keydown', firstGesture);
      document.removeEventListener('visibilitychange', checkExpiry);
      window.removeEventListener('pageshow', checkExpiry);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', position);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position);
      try { context?.close()?.catch(() => {}); } catch { /* Optional sound. */ }
    }
    function checkExpiry() { if (performance.now() >= deadline) remove(); }
    function notify() {
      if (!active() || played || performance.now() - lastPlayed < 2000) return;
      played = true; lastPlayed = performance.now();
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context ||= new Audio();
        Promise.resolve(context.resume()).then(() => {
          if (!active() || context.state !== 'running') return;
          for (const [index, frequency] of [659.25, 880, 1046.5].entries()) {
            const oscillator = context.createOscillator(), gain = context.createGain();
            const at = context.currentTime + index * .14;
            oscillator.type = 'sine'; oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.035, at + .015);
            gain.gain.exponentialRampToValueAtTime(.001, at + .22);
            oscillator.connect(gain); gain.connect(context.destination);
            oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
            oscillator.start(at); oscillator.stop(at + .24);
          }
        }).catch(() => {});
      } catch { /* Text remains available if autoplay or audio fails. */ }
    }
    function firstGesture(event) {
      const target = event.target;
      // A click in the form or on its controls must remain quiet and untouched.
      if (!event.isTrusted || !active() || target?.closest?.('input,textarea,select,button,a,form,[contenteditable="true"],dialog,[role="dialog"]')) return;
      notify();
    }
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(key) === 'dismissed'; } catch { /* Storage optional. */ }
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 12 * 3600000 || dismissed) remove();
    else {
      const close = notice.querySelector('[data-posi-notice-close]');
      close.hidden = false;
      close.addEventListener('click', dismiss);
      notice.querySelector('[data-posi-notice-ack]').addEventListener('click', dismiss);
      const sound = notice.querySelector('[data-posi-notice-sound]');
      if (window.AudioContext || window.webkitAudioContext) {
        sound.hidden = false;
        sound.addEventListener('click', () => { played = false; notify(); });
        document.addEventListener('pointerdown', firstGesture, { passive: true });
        document.addEventListener('keydown', firstGesture, { passive: true });
      }
      try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const labels = { 'Asia/Jakarta': '12.00 WIB', 'Asia/Pontianak': '12.00 WIB', 'Asia/Makassar': '13.00 WITA', 'Asia/Ujung_Pandang': '13.00 WITA', 'Asia/Jayapura': '14.00 WIT' };
        if (labels[zone]) { const local = notice.querySelector('[data-posi-local-time]'); local.textContent = 'Di zona waktu Anda: ' + labels[zone]; local.hidden = false; }
      } catch { /* All three time zones are always shown. */ }
      // Server-derived duration avoids depending on an incorrect device clock.
      expiryTimer = setTimeout(remove, remaining);
      document.addEventListener('visibilitychange', checkExpiry);
      window.addEventListener('pageshow', checkExpiry);
      document.addEventListener('keydown', escape);
      document.addEventListener('pointerdown', outside, { capture: true, passive: true });
      document.addEventListener('focusin', position);
      window.addEventListener('resize', position, { passive: true });
      window.addEventListener('scroll', position, { passive: true });
      popupTimer = setInterval(position, 600);
      position();
    }
  }
} catch { /* Notification failures never become checkout failures. */ }
