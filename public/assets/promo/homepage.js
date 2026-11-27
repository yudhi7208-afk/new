(function () {
  'use strict';
  var dialog = document.getElementById('pl-homepage-promo');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  var stage = dialog.querySelector('.pl-promo-stage');
  var slides = Array.from(stage.querySelectorAll('img'));
  var image = slides[0];
  var close = dialog.querySelector('.pl-promo-close');
  var status = dialog.querySelector('.pl-promo-status');
  var key = 'posloker-homepage-promo-seen-v2';
  var attempted = false;
  var active = 0;
  var gesture = null;
  var lastSwipe = 0;

  function loadSlide(slide) {
    if (!slide.hasAttribute('src')) slide.src = slide.dataset.src;
  }

  function changeSlide(step) {
    slides[active].hidden = true;
    active = (active + step + slides.length) % slides.length;
    loadSlide(slides[active]);
    slides[active].hidden = false;
    status.textContent = (active + 1) + ' / ' + slides.length;
  }

  close.addEventListener('click', function () { dialog.close(); });
  dialog.querySelector('.pl-promo-prev').addEventListener('click', function () { changeSlide(-1); });
  dialog.querySelector('.pl-promo-next').addEventListener('click', function () { changeSlide(1); });
  dialog.addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    changeSlide(event.key === 'ArrowLeft' ? -1 : 1);
  });
  stage.addEventListener('pointerdown', function (event) {
    if (event.isPrimary && event.pointerType !== 'mouse') {
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  stage.addEventListener('pointercancel', function () { gesture = null; });
  stage.addEventListener('pointerup', function (event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    var dx = event.clientX - gesture.x;
    var dy = event.clientY - gesture.y;
    gesture = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
    lastSwipe = Date.now();
    changeSlide(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('dragstart', function (event) { event.preventDefault(); });

  // Close before the event bubbles to the existing order wizard handler.
  [stage, dialog.querySelector('.pl-promo-cta')].forEach(function (link) {
    link.addEventListener('click', function (event) {
      if (link === stage && event.detail && Date.now() - lastSwipe < 300) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      dialog.close();
    });
  });

  window.poslokerShowHomepagePromo = function (fallback) {
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
      if (!navigator.connection?.saveData) loadSlide(slides[1]);
    }
    function onLoad() { finish(image.naturalWidth > 0); }
    function onError() { finish(false); }
    var timer = setTimeout(onError, 5000);
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    loadSlide(image);
    if (image.complete) onLoad();
    return true;
  };
}());
