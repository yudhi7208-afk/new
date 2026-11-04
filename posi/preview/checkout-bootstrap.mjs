import { bootPosi } from '/widget/loader.mjs';
import { createCheckoutAdapter } from '/preview/checkout-adapter.mjs';

// Loaded ONLY by the local synthetic proxy, never by production HTML.
const adapter = createCheckoutAdapter();
bootPosi({ enabled: !new URLSearchParams(location.search).has('posiOff'), apiBase: '', adapter }).then(result => {
  document.querySelector('[data-posi-open]')?.addEventListener('click', () => result.open?.());
}).catch(() => {});
