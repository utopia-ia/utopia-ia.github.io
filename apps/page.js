// The apps page's behaviour (language switch, demo videos, links to other apps when installed). Files and not inline
// scripts: the site's Content-Security-Policy runs no inline script (deploy/headers.json). Loaded at the end of <body>,
// where the inline scripts were.
(function () {
  'use strict';
  var KEY = 'elffuss-lang';
  var root = document.documentElement;
  var TITLE = {
    en: 'Elffuss: make pictures, video and music in your browser',
    es: 'Elffuss: crea imágenes, vídeo y música en tu navegador'
  };
  var lang = root.lang === 'es' ? 'es' : 'en';

  function each(selector, fn) {
    var list = document.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  function apply(value) {
    lang = value;
    root.lang = value;
    document.title = TITLE[value];
    each('[data-set-lang]', function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === value));
    });
    each('[data-aria-' + value + ']', function (el) {
      el.setAttribute('aria-label', el.getAttribute('data-aria-' + value));
    });
    each('[data-alt-' + value + ']', function (el) {
      el.setAttribute('alt', el.getAttribute('data-alt-' + value));
    });
    /* Posters that exist in both languages follow the page language. */
    each('img[data-src-' + value + ']', function (el) {
      var src = el.getAttribute('data-src-' + value);
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    });
  }

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
    try {
      var url = new URL(location.href);
      if (url.searchParams.has('lang')) {
        url.searchParams.set('lang', value);
        history.replaceState(null, '', url.toString());
      }
    } catch (e) {}
  }

  /* Videos load only when asked for: the poster is replaced by a video with controls. */
  function play(button) {
    var figure = button.parentNode;
    var img = figure.querySelector('img');
    var video = document.createElement('video');
    ['en', 'es'].forEach(function (l) { video.setAttribute('data-aria-' + l, button.getAttribute('data-name-' + l)); });
    video.setAttribute('aria-label', button.getAttribute('data-name-' + lang));
    video.setAttribute('preload', 'none');
    video.setAttribute('playsinline', '');
    video.setAttribute('width', button.getAttribute('data-w'));
    video.setAttribute('height', button.getAttribute('data-h'));
    video.controls = true;
    /* Only videos without a sound track start muted; one with speech keeps its sound, since the tap allows it. */
    video.muted = button.hasAttribute('data-muted');
    video.loop = button.hasAttribute('data-loop');
    video.playsInline = true;
    if (img) video.poster = img.currentSrc || img.src;
    video.src = button.getAttribute('data-src');
    video.addEventListener('play', function () {
      each('video, audio', function (other) { if (other !== video && !other.paused) other.pause(); });
    });
    if (img) figure.replaceChild(video, img); else figure.appendChild(video);
    figure.removeChild(button);
    video.focus();
    var started = video.play();
    if (started && typeof started.catch === 'function') started.catch(function () {});
  }
  /* One sound at a time: starting a clip pauses whatever else plays. */
  document.addEventListener('play', function (event) {
    each('video, audio', function (other) { if (other !== event.target && !other.paused) other.pause(); });
  }, true);

  apply(lang);

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var toggle = target.closest('[data-set-lang]');
    if (toggle) {
      var value = toggle.getAttribute('data-set-lang') === 'es' ? 'es' : 'en';
      apply(value);
      remember(value);
      return;
    }
    var button = target.closest('button.play');
    if (button) play(button);
  });
})();

/* Installed as an app (elffuss.com), a link to another Elffuss app opens outside this window: in a browser tab, or in
   that app's own window when it is installed too, and not under the browser's bar with the address. */
addEventListener('click', function (e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!(matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)) return;
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return;
  e.preventDefault();
  window.open(u.href, '_blank', 'noopener');
});
