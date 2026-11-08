// The page's language before first paint (index.html, the chat). A file and not an inline script: the site's
// Content-Security-Policy runs no inline script (deploy/headers.json). Loaded with a plain <script src> in <head>, so it
// still runs before the body is painted.
/* Language before first paint: ?lang=, then the saved choice, then a browser language starting with "es", then English.
   The Spanish URL (?lang=es) is its own canonical, so Spanish keeps an indexable address. */
(function () {
  var d = document.documentElement, l = null, q = null;
  function ok(v) { return v === 'en' || v === 'es' ? v : null; }
  try { q = l = ok(new URLSearchParams(location.search).get('lang')); } catch (e) {}
  if (!l) { try { l = ok(localStorage.getItem('elffuss-lang')); } catch (e) {} }
  if (!l) { l = (navigator.language || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en'; }
  d.lang = l;
  d.className += ' js';
  if (l === 'es') document.title = 'Elffuss · Chatea con una IA que corre en tu navegador';
  if (q === 'es') { var c = document.querySelector('link[rel="canonical"]'); if (c) c.href = 'https://elffuss.com/?lang=es'; }
})();
