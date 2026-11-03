import { bootPosi } from '/widget/loader.mjs';
import { createCheckoutAdapter } from '/preview/checkout-adapter.mjs';

// Explicitly enabled only in this sandbox. Production imports none of these files.
const adapter = createCheckoutAdapter();
try {
  const result = await bootPosi({ enabled: true, apiBase: '', adapter, greetingDelayMs: 4500 });
  document.getElementById('status').textContent = result.enabled ? (result.aiEnabled ? 'Workers AI aktif pada pratinjau POSI. Silakan ajukan pertanyaan melalui tombol robot.' : 'POSI siap dicoba melalui tombol robot dengan panduan yang tersedia.') : 'POSI dinonaktifkan. Contoh formulir tetap dapat diisi.';
} catch {
  document.getElementById('status').textContent = 'POSI belum tersedia. Contoh formulir tetap dapat diisi.';
}
