// Optional UI only: never reads forms, waits for AI, or changes order state.
try {
  const notice = document.getElementById('posi-service-notice');
  if (notice) {
    const remaining = Number(notice.dataset.remainingMs);
    const deadline = performance.now() + remaining;
    const key = 'posi-posting-notice-2026-11-05';
    let closed = false, context, played = false, expiryTimer, lastPlayed = -Infinity;
    const active = () => !closed && !document.hidden && performance.now() < deadline;
    function remove() {
      closed = true; notice.remove();
      clearTimeout(expiryTimer);
      document.removeEventListener('pointerdown', firstGesture);
      document.removeEventListener('keydown', firstGesture);
      document.removeEventListener('visibilitychange', checkExpiry);
      window.removeEventListener('pageshow', checkExpiry);
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
      close.addEventListener('click', () => { try { sessionStorage.setItem(key, 'dismissed'); } catch { /* Optional. */ } remove(); });
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
    }
  }
} catch { /* Notification failures never become checkout failures. */ }
