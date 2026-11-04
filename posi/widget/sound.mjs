// Only an original chime or a fixed greeting is spoken. Never reads chat/form.
export const SPOKEN_GREETING = 'Halo, ada yang bisa saya bantu?';
export function createPosiSound({ scope = globalThis, isVisible = () => !scope.document?.hidden, now = Date.now } = {}) {
  let context, primed = false, enabled = true, destroyed = false, lastPlayed = -Infinity, utterance;
  const nodes = new Set();
  function stop() {
    for (const node of nodes) { try { node.stop(); } catch { /* Already ended. */ } }
    nodes.clear();
    if (utterance) { utterance.onerror = null; utterance.onend = null; try { scope.speechSynthesis?.cancel(); } catch { /* Optional voice. */ } utterance = null; }
  }
  function prime() {
    if (!enabled || destroyed) return;
    primed = true;
    try {
      const Audio = scope.AudioContext || scope.webkitAudioContext;
      if (!context && Audio) context = new Audio();
      if (context?.state === 'suspended') Promise.resolve(context.resume()).catch(() => {});
    } catch { /* Speech or visual greeting remains available. */ }
  }
  function chime() {
    if (!enabled || !primed || destroyed || !isVisible() || context?.state !== 'running' || now() - lastPlayed < 2000) return false;
    try {
      const start = context.currentTime;
      for (const [index, frequency] of [659.25, 880, 1046.5].entries()) {
        const osc = context.createOscillator(), gain = context.createGain(), at = start + index * .13;
        osc.type = 'sine'; osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.045, at + .015); gain.gain.exponentialRampToValueAtTime(.001, at + .22);
        osc.connect(gain); gain.connect(context.destination); nodes.add(osc);
        osc.onended = () => { nodes.delete(osc); try { osc.disconnect(); gain.disconnect(); } catch { /* Optional cleanup. */ } };
        osc.start(at); osc.stop(at + .24);
      }
      lastPlayed = now(); return true;
    } catch { return false; }
  }
  function greet() {
    if (!enabled || !primed || destroyed || !isVisible() || now() - lastPlayed < 2000) return false;
    try {
      const synth = scope.speechSynthesis;
      const voice = synth?.getVoices?.().find(item => /^id(?:-|_)/i.test(item.lang) && item.localService !== false);
      // Use a local Indonesian voice when present; otherwise the gentle chime
      // avoids speaking with an unrelated voice or sending text to a provider.
      if (voice && scope.SpeechSynthesisUtterance && !synth.speaking && !synth.pending) {
        const next = new scope.SpeechSynthesisUtterance(SPOKEN_GREETING);
        next.lang = 'id-ID'; next.voice = voice; next.volume = .65; next.rate = 1; next.pitch = 1.08;
        utterance = next;
        next.onend = () => { if (utterance === next) utterance = null; };
        next.onerror = () => { if (utterance === next) { utterance = null; lastPlayed = -Infinity; chime(); } };
        synth.speak(next); lastPlayed = now(); return true;
      }
    } catch { /* Chime fallback. */ }
    return chime();
  }
  return {
    prime, greet, notify: chime,
    setEnabled(value) { enabled = value === true; if (!enabled) stop(); return enabled; },
    get enabled() { return enabled && !destroyed; },
    get available() { return Boolean(scope.AudioContext || scope.webkitAudioContext || scope.speechSynthesis); },
    stop,
    destroy() { destroyed = true; enabled = false; stop(); try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* No dependency. */ } },
  };
}
