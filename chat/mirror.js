// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Where this copy of the site runs. https://elffuss.com is the official site. The same files are also published as a
// public copy on GitHub Pages (https://utopia-ia.github.io/) for networks where *.elffuss.com is blocked and
// github.com is not. On that copy (`mirror`) the page must work with every elffuss.com host unreachable, so it never
// asks one for anything on its own:
//
//   · the model's weights come from Hugging Face (byte-identical files, see chat.js), not from m1/models.elffuss.com;
//   · the shared model store (models.elffuss.com) is not embedded: its storage would be partitioned under this site
//     anyway, so it could not share a download with the Elffuss apps; this origin keeps its own copy;
//   · Claw's pages are not embedded: the apps bridge (bridge.html) and the shared memory's store page (/memory/)
//     answer only https://elffuss.com, and from another site their storage would be partitioned anyway. Apps are kept
//     in this browser (local.js) and the memory runs the engine's store in the page (memory-wire.js);
//   · web search has no proxy here (it lives at elffuss.com/proxy), so the web tools are off;
//   · links to the Elffuss apps open in a new tab and say they are on elffuss.com.
//
// A user's fork of the public copy (https://<user>.github.io/elffuss-chat/, the code «tu versión» of a programmer) is
// this same mirror mode, and only that: no state between the two, by design (the security review of 8-nov dropped
// shared memory, the model store and our services for forks). «Tu versión» as a theme lives on elffuss.com
// (theme.js) and is off here.
//
// localhost and 127.0.0.1 count as the official site, as they always did for development.
// No imports: the apps page loads this file without the engine.

export const OFFICIAL = 'https://elffuss.com';
const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/;
export const mirror = typeof location !== 'undefined' && location.origin !== OFFICIAL && !DEV.test(location.hostname);

const lang = () => (document.documentElement.lang === 'es' ? 'es' : 'en');

const NOTE = {
  en: { lead: 'Official site: ', rest: ' — this copy works where elffuss.com is blocked. Memory and apps stay in this browser and are not shared with Claw or Code.', app: 'on elffuss.com' },
  es: { lead: 'Sitio oficial: ', rest: ' — esta copia funciona donde elffuss.com está bloqueado. La memoria y las apps se quedan en este navegador y no se comparten con Claw ni con Code.', app: 'en elffuss.com' },
};

// The chat's words that change on the copy (merged over chat.js's own).
export const WORDS = {
  en: {
    appSavedLine: 'Saved in this browser (this copy does not share apps with Claw)',
    appNotSavedLine: 'Runs here, not saved: this browser’s storage is not available',
    panelSaved: 'Saved in this browser',
    appsDown: 'Your apps are not available: this browser’s storage does not answer.',
    askAppsBody: 'Apps made here are kept in this browser and listed under Your apps. On this copy they are not shared with Claw. It runs here either way. You are asked once.',
    mineEmpty: 'Apps you build here show up here.',
    mineDown: 'Not available: this browser’s storage does not answer.',
    memCount: (n) => (n === 0 ? 'Remembers nothing yet · this browser' : n === 1 ? 'Remembers 1 thing · this browser' : `Remembers ${n} things · this browser`),
    webOff: 'Web search works on elffuss.com only: this copy has no search proxy.',
  },
  es: {
    appSavedLine: 'Guardada en este navegador (esta copia no comparte las apps con Claw)',
    appNotSavedLine: 'Funciona aquí, sin guardar: el almacén de este navegador no está disponible',
    panelSaved: 'Guardada en este navegador',
    appsDown: 'Tus apps no están disponibles: el almacén de este navegador no responde.',
    askAppsBody: 'Las apps que se hacen aquí se guardan en este navegador y aparecen en Tus apps. En esta copia no se comparten con Claw. Funciona aquí igualmente. Se pregunta una sola vez.',
    mineEmpty: 'Aquí aparecen las apps que construyas aquí.',
    mineDown: 'No disponible: el almacén de este navegador no responde.',
    memCount: (n) => (n === 0 ? 'Aún no recuerda nada · este navegador' : n === 1 ? 'Recuerda 1 cosa · este navegador' : `Recuerda ${n} cosas · este navegador`),
    webOff: 'La búsqueda web solo funciona en elffuss.com: esta copia no tiene el proxy de búsqueda.',
  },
};

const WELCOME = {
  en: 'Ask it for a small app and it builds it here, ready to use. Ask it to remember something and it remembers it in this browser.',
  es: 'Pídele una app pequeña y la construye aquí, lista para usar. Pídele que recuerde algo y lo recordará en este navegador.',
};

// The note at the top of the page, the links that leave for elffuss.com, and the welcome line. Repaints itself when
// the page's language changes. Does nothing on the official site.
export function mountNote(where = document.querySelector('main')) {
  if (!mirror || !where || document.getElementById('mirror-note')) return;
  const p = document.createElement('p');
  p.id = 'mirror-note';
  p.setAttribute('role', 'note');
  p.style.cssText = 'margin:0;padding:6px 16px;background:var(--ef-tape-soft,#fff1c2);color:var(--ef-ink,#191b1e);'
    + 'font-size:var(--ef-text-xs,0.8125rem);line-height:1.4;text-align:center;border-bottom:1px solid var(--ef-steel,#d7dbdf)';
  const paint = () => {
    const w = NOTE[lang()];
    p.textContent = w.lead;
    const a = document.createElement('a');
    a.href = OFFICIAL + '/'; a.textContent = 'elffuss.com'; a.target = '_blank'; a.rel = 'noopener'; a.dataset.outside = '';
    a.style.color = 'inherit';
    p.append(a, document.createTextNode(w.rest));
    for (const el of document.querySelectorAll('[data-mirror-app]')) el.textContent = ' · ' + w.app;
  };
  where.prepend(p);

  // Every link to another Elffuss site leaves in a new tab and says where it goes.
  for (const a of document.querySelectorAll('a[href]')) {
    let u; try { u = new URL(a.href, location.href); } catch { continue; }
    if (!/(^|\.)elffuss\.com$/.test(u.hostname)) continue;
    a.target = '_blank'; a.rel = 'noopener'; a.dataset.outside = '';
    const line = a.querySelector('.app-line');
    if (line && !line.querySelector('[data-mirror-app]')) { const s = document.createElement('span'); s.dataset.mirrorApp = ''; line.append(s); }
  }
  // Paths the docroot of elffuss.com serves but this copy does not have.
  for (const a of document.querySelectorAll('a[href^="/how-it-works/"], a[href^="/como-funciona/"], a[href^="/blog/"]')) {
    a.href = OFFICIAL + a.getAttribute('href'); a.target = '_blank'; a.rel = 'noopener'; a.dataset.outside = '';
  }
  for (const el of document.querySelectorAll('.welcome-can')) el.textContent = WELCOME[el.getAttribute('lang') === 'es' ? 'es' : 'en'];
  // No web search here, so the promise that only a search leaves the device is simply that nothing does.
  for (const el of document.querySelectorAll('.welcome > p:not(.welcome-can)')) {
    el.textContent = el.getAttribute('lang') === 'es'
      ? 'Responde un modelo que corre en este navegador, en tu propio dispositivo. Lo que escribes no sale de él.'
      : 'A model running in this browser writes the answer, on your own device. What you type does not leave it.';
  }

  paint();
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
