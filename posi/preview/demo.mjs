import { bootPosi } from '/widget/loader.mjs';
import { createCheckoutAdapter } from '/preview/checkout-adapter.mjs';
import { createPosiSound } from '/widget/sound.mjs';

// Explicitly enabled only in this sandbox. Production imports none of these files.
const adapter = createCheckoutAdapter();
try {
  const result = await bootPosi({ enabled: true, apiBase: '', adapter });
  document.getElementById('status').textContent = result.enabled ? 'POSI siap mendampingi dan bersembunyi sampai bantuan diperlukan.' : 'POSI dinonaktifkan. Contoh formulir tetap dapat diisi.';
  document.getElementById('openPosi').disabled = !result.enabled;
  document.getElementById('openPosi').addEventListener('click', () => result.open?.());
} catch {
  document.getElementById('status').textContent = 'POSI belum tersedia. Contoh formulir tetap dapat diisi.';
}
const sound = createPosiSound();
document.getElementById('tryPosiSound').addEventListener('click', () => {
  sound.prime();
  setTimeout(() => { document.getElementById('soundStatus').textContent = sound.greet() ? 'Sapaan suara atau bunyi notifikasi telah diminta. Pastikan perangkat tidak dibisukan.' : 'Browser belum mengizinkan audio. Sapaan teks tetap tersedia.'; }, 30);
});
addEventListener('pagehide', () => sound.destroy(), { once: true });
