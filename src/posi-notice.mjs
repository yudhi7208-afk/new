// Owner-authorized, temporary announcement only. No AI or order dependencies.
export const NOTICE_START = Date.parse('2026-11-05T00:00:00+07:00');
export const NOTICE_END = Date.parse('2026-11-05T12:00:00+07:00');

export function noticeActive(env, now = Date.now()) {
  return env.POSI_NOTICE_ENABLED === 'true' && now >= NOTICE_START && now < NOTICE_END;
}

export function withPosiNotice(response, request, env, now = Date.now()) {
  const path = new URL(request.url).pathname;
  if (!noticeActive(env, now) || request.method !== 'GET' || response.status !== 200 ||
      !response.headers.get('Content-Type')?.includes('text/html') ||
      /^(?:\/admin|\/api|\/wp-admin|\/wp-login|\/checkout)(?:[/.]|$)/.test(path)) return response;
  // Static, author-owned copy. Keep every existing input, listener and endpoint.
  const notice = `<aside id="posi-service-notice" role="dialog" aria-modal="false" aria-label="Informasi jadwal posting PosLoker" data-remaining-ms="${NOTICE_END - now}" hidden>
    <img src="/posi-notice/apology.svg" width="84" height="92" alt="POSI meminta maaf">
    <div class="posi-notice-bubble"><button type="button" data-posi-notice-close aria-label="Tutup informasi POSI" hidden>×</button>
    <p class="posi-notice-label">INFO POSI · 5 NOVEMBER 2026</p>
    <p class="posi-notice-title">Mohon maaf, ada penyesuaian jam posting hari ini.</p>
    <p>Karena tim sedang ada meeting, order yang masuk hari ini akan mulai diposting pukul <strong>12.00 siang WIB</strong>.</p>
    <p class="posi-notice-times"><strong>12.00 WIB</strong><span> / </span><strong>13.00 WITA</strong><span> / </span><strong>14.00 WIT</strong></p>
    <p data-posi-local-time hidden></p><p>Anda tetap bisa mengirim pesanan seperti biasa. Terima kasih sudah menunggu.</p>
    <div class="posi-notice-actions"><button type="button" data-posi-notice-ack>Saya mengerti</button><button type="button" data-posi-notice-sound hidden>♪ Dengarkan notifikasi</button></div></div></aside>`;
  try {
    const rewritten = new HTMLRewriter()
      .on('head', { element: el => el.append('<link rel="stylesheet" href="/posi-notice/notice.css?v=popup1"><script type="module" src="/posi-notice/notice.mjs?v=popup1"></script>', { html: true }) })
      .on('main', { element(el) { el.prepend(notice, { html: true }); } })
      .transform(response);
    const headers = new Headers(rewritten.headers);
    for (const name of ['Content-Length', 'ETag', 'Last-Modified']) headers.delete(name);
    headers.set('Cache-Control', 'no-store');
    return new Response(rewritten.body, { status: rewritten.status, headers });
  } catch { return response; }
}
