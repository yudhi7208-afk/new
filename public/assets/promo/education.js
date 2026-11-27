(function () {
  'use strict';
  var dialog = document.getElementById('pl-education-promo');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  var image = dialog.querySelector('img');
  var close = dialog.querySelector('.pl-promo-close');
  var key = 'posloker-education-promo-seen-v1';
  var attempted = false;

  close.addEventListener('click', function () { dialog.close(); });
  // Close before the event bubbles to the existing order wizard handler.
  dialog.querySelector('.pl-promo-cta').addEventListener('click', function (event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    dialog.close();
  });

  window.poslokerShowEducationPromo = function (fallback) {
    if (attempted || location.hash === '#pilih-paket') return false;
    try { if (sessionStorage.getItem(key)) return false; } catch (error) {}
    attempted = true;
    var settled = false;
    function finish(loaded) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      // Never interrupt another modal, a checkout deep link, or data entry.
      if (location.hash === '#pilih-paket' || document.querySelector('dialog[open]') ||
          document.activeElement?.matches('input,select,textarea,[contenteditable="true"]')) return;
      if (!loaded) { fallback(); return; }
      try { dialog.showModal(); } catch (error) { fallback(); return; }
      close.focus({ preventScroll: true });
      try { sessionStorage.setItem(key, '1'); } catch (error) {}
    }
    function onLoad() { finish(image.naturalWidth > 0); }
    function onError() { finish(false); }
    var timer = setTimeout(onError, 5000);
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    image.src = image.dataset.src;
    if (image.complete) onLoad();
    return true;
  };
}());
