// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The other Elffuss apps, opened inside elffuss.com instead of leaving it: the app fills the main area in a frame,
// under a slim bar with the way back to the chat and a link to open it on its own.
//
// Only the apps that work in a frame are opened here. Code is not: a framed page from another site cannot open the
// folder picker, which is what Code is for. Tools is not either: its site refuses to be framed. Those two open
// outside, as any other link.
//
// Each app keeps its frame while the visitor goes back to the chat, so returning finds it as it was. The address
// carries #app=<name>, so the back button and gesture return to the chat, and a reload reopens the app.
//
// Inside elffuss.com an app keeps its own storage for this site, apart from the copy it has at its own address (the
// browser partitions a framed site's storage by the page around it). The chat reaches Claw's memory and apps through
// a frame too, so here they are the same ones the chat sees.
import { mirror } from './mirror.js';

const APPS = {
  'claw.elffuss.com': { key: 'claw', name: { en: 'Claw', es: 'Claw' }, color: 'var(--ef-claw)' },
  'translator.elffuss.com': { key: 'translator', name: { en: 'Translator', es: 'Translator' }, color: 'var(--ef-translator)' },
  'copilot.elffuss.com': { key: 'copilot', name: { en: 'Copilot', es: 'Copiloto' }, color: 'var(--ef-copiloto)' },
  'braid.elffuss.com': { key: 'braid', name: { en: 'Braid', es: 'Braid' }, color: 'var(--ef-braid)' },
};
const BY_KEY = Object.fromEntries(Object.entries(APPS).map(([host, a]) => [a.key, { ...a, host }]));
// What the apps ask the browser for: the microphone and the screen's sound (Translator, Copilot), the clipboard,
// full screen and keeping the screen on.
const ALLOW = 'microphone; camera; display-capture; clipboard-read; clipboard-write; fullscreen; autoplay; screen-wake-lock; speaker-selection';

const T = {
  en: { back: 'Chat', backLabel: 'Back to the chat', outside: 'Open on its own' },
  es: { back: 'Chat', backLabel: 'Volver al chat', outside: 'Abrir aparte' },
};
const words = () => T[document.documentElement.lang === 'es' ? 'es' : 'en'];
const lang = () => (document.documentElement.lang === 'es' ? 'es' : 'en');

let view = null, bar = null, frames = null, current = null;
const loaded = new Map();     // key → { frame, url }
let onShow = () => {};

// Not on the public copy (mirror.js): there the apps may be blocked, and they open in their own tab on elffuss.com.
export const embeddable = (url) => !mirror && Object.hasOwn(APPS, url.host) && url.protocol === 'https:';

function build() {
  if (view) return;
  view = document.createElement('section');
  view.className = 'appview';
  view.hidden = true;
  bar = document.createElement('div');
  bar.className = 'appview-bar';
  frames = document.createElement('div');
  frames.className = 'appview-frames';
  view.append(bar, frames);
  document.getElementById('main').append(view);
  new MutationObserver(paintBar).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

function paintBar() {
  if (!bar || !current) return;
  const w = words(), app = BY_KEY[current], entry = loaded.get(current);
  bar.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'appview-back'; back.setAttribute('aria-label', w.backLabel);
  back.innerHTML = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>';
  back.append(document.createTextNode(w.back));
  back.addEventListener('click', () => { if (/^#app=/.test(location.hash)) history.back(); else hide(); });
  const name = document.createElement('b');
  name.className = 'appview-name'; name.style.setProperty('--c', app.color);
  name.textContent = app.name[lang()];
  const out = document.createElement('a');
  out.className = 'appview-out'; out.href = entry?.url || `https://${app.host}/`;
  out.target = '_blank'; out.rel = 'noopener';
  out.dataset.outside = '';
  out.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-external"/></svg>';
  out.append(document.createTextNode(w.outside));
  bar.append(back, name, out);
}

function show(key, url) {
  build();
  const app = BY_KEY[key];
  let entry = loaded.get(key);
  if (!entry) {
    const frame = document.createElement('iframe');
    frame.className = 'appview-frame';
    frame.allow = ALLOW;
    frame.title = app.name[lang()];
    frame.src = url;
    frames.append(frame);
    entry = { frame, url };
    loaded.set(key, entry);
  }
  for (const [k, e] of loaded) e.frame.hidden = k !== key;
  current = key;
  paintBar();
  view.hidden = false;
  document.getElementById('main').classList.add('has-app');
  onShow(key);
  entry.frame.focus({ preventScroll: true });
}

export function hide() {
  if (!view || view.hidden) return;
  view.hidden = true;
  current = null;
  document.getElementById('main').classList.remove('has-app');
  onShow(null);
}

// Opens an app from a link. Returns false when the link is not one of the apps that open here.
export function open(href) {
  let url;
  try { url = new URL(href, location.href); } catch { return false; }
  if (!embeddable(url)) return false;
  const key = APPS[url.host].key;
  if (location.hash !== '#app=' + key) history.pushState({ app: key }, '', '#app=' + key);
  show(key, url.href);
  return true;
}

// The address decides: #app=<name> shows that app, anything else the chat.
function fromHash() {
  if (mirror) { hide(); return; }
  const m = location.hash.match(/^#app=(\w+)$/);
  if (m && BY_KEY[m[1]]) show(m[1], loaded.get(m[1])?.url || `https://${BY_KEY[m[1]].host}/`);
  else hide();
}

export function start({ onChange } = {}) {
  if (onChange) onShow = onChange;
  addEventListener('popstate', fromHash);
  if (/^#app=/.test(location.hash)) fromHash();
}
