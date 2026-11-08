// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The other Elffuss apps and tools, opened inside elffuss.com instead of leaving it: the app fills the main area in a
// frame (the whole screen on a phone), under a slim bar with the way back to the chat and a link to open it in a tab.
//
// Only the apps and tools that work in a frame are opened here: the tools Image, Video and Audio (their sites let
// https://elffuss.com frame them, elffuss-ai deploy/headers.mjs), Translator, Copilot, Claw and Braid. Code is not: a
// framed page from another site cannot open the folder picker, which is what Code is for. Tools (the catalog) and the
// other tools are not either: their sites refuse to be framed. Those open outside, as any other link.
//
// Each app keeps its frame while the visitor goes back to the chat, so returning finds it as it was, and the chat is
// never touched (the frame covers it). The address carries #app=<name>, so the back button and gesture return to the
// chat, and a reload reopens the app. A link from another page opens one here too: /?tool=<name>, /#app=<name> or
// /#<name> (the apps page's «Try it» buttons); the chat's own address goes under it in the history, so «back» from
// the app is the chat, not the page the link was on.
//
// An app's storage inside this frame is the same as at its own address: every *.elffuss.com site is the same «site»
// as elffuss.com, which is what the browsers partition by, so the models a tool keeps (in the shared store,
// models.elffuss.com, which it embeds in turn) are the ones it already had.
//
// Not when this page is cross-origin isolated (chat.js isolates it on computers that run the model on the processor):
// an isolated page may only frame pages that opt in to it (COEP and CORP), and the apps do not. There every app opens
// in a tab, and a link from another page shows the way to it.
//
// A tool inside the frame asks this page to open its links to the chat or to another app ({ type: 'elffuss:open' },
// elffuss-ai shared/embed.js), after this page has told it which hosts it opens ({ type: 'elffuss:embed' }); links to
// anything else it opens in a tab itself.
import { mirror } from './mirror.js';

const APPS = {
  'image.elffuss.com': { key: 'image', name: { en: 'Image', es: 'Imagen' }, icon: 't-image', en: '/en/' },
  'video.elffuss.com': { key: 'video', name: { en: 'Video', es: 'Vídeo' }, icon: 't-video', en: '/en/' },
  'audio.elffuss.com': { key: 'audio', name: { en: 'Audio', es: 'Audio' }, icon: 't-audio', en: '/en/' },
  'translator.elffuss.com': { key: 'translator', name: { en: 'Translator', es: 'Translator' }, icon: 't-translator', color: 'var(--ef-translator)' },
  'copilot.elffuss.com': { key: 'copilot', name: { en: 'Copilot', es: 'Copiloto' }, icon: 't-copilot', color: 'var(--ef-copiloto)' },
  'claw.elffuss.com': { key: 'claw', name: { en: 'Claw', es: 'Claw' }, color: 'var(--ef-claw)' },
  'braid.elffuss.com': { key: 'braid', name: { en: 'Braid', es: 'Braid' }, color: 'var(--ef-braid)' },
};
const BY_KEY = Object.fromEntries(Object.entries(APPS).map(([host, a]) => [a.key, { ...a, host }]));
// What the apps ask the browser for: the microphone and the screen's sound (Translator, Copilot), the camera, the
// clipboard, full screen (a video), sound that starts on its own, keeping the screen on, and the share sheet (how a
// tool saves its result on an iPhone, elffuss-ai shared/shell.js). A cross-origin frame gets none of these unless
// they are listed here, and this page's own Permissions-Policy must allow them for the app's origin too.
export const ALLOW = 'microphone; camera; display-capture; clipboard-read; clipboard-write; fullscreen; autoplay; screen-wake-lock; speaker-selection; web-share';

const T = {
  en: { back: 'Chat', backLabel: 'Back to the chat', outside: 'Open in a tab', outsideLabel: (n) => `Open ${n} in a browser tab`,
    isolated: (n) => `${n} cannot open inside the chat on this computer. It opens in a tab.` },
  es: { back: 'Chat', backLabel: 'Volver al chat', outside: 'Abrir en pestaña', outsideLabel: (n) => `Abrir ${n} en una pestaña del navegador`,
    isolated: (n) => `${n} no puede abrirse dentro del chat en este ordenador. Se abre en una pestaña.` },
};
const lang = () => (document.documentElement.lang === 'es' ? 'es' : 'en');
const words = () => T[lang()];

let view = null, bar = null, frames = null, current = null;
const loaded = new Map();     // key → { frame, url } (frame: null when only the «open in a tab» card is shown)
let onShow = () => {};

// Not on the public copy (mirror.js): there the apps may be blocked, and they open in their own tab on elffuss.com.
// Not on an isolated page either (see above).
const isolated = () => self.crossOriginIsolated === true;
export const embeddable = (url) => !mirror && !isolated() && Object.hasOwn(APPS, url.host) && url.protocol === 'https:';

// The app's address at its start: the English page of a tool when the chat is in English.
function home(app) {
  return `https://${app.host}${lang() === 'en' && app.en ? app.en : '/'}`;
}

function svgUse(id, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

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
  new MutationObserver(() => { paintBar(); paintCards(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // Escape in the bar goes back to the chat (inside the frame the app has the keyboard).
  view.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !view.hidden) back(); });
}

function back() {
  if (/^#app=/.test(location.hash)) history.back(); else hide();
}

function paintBar() {
  if (!bar || !current) return;
  const w = words(), app = BY_KEY[current], entry = loaded.get(current);
  const label = app.name[lang()];
  bar.replaceChildren();
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'appview-back'; b.setAttribute('aria-label', w.backLabel);
  const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chev.setAttribute('class', 'ic'); chev.setAttribute('aria-hidden', 'true'); chev.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M15 6l-6 6 6 6');
  chev.append(p);
  b.append(chev, document.createTextNode(w.back));
  b.addEventListener('click', back);
  const name = document.createElement('b');
  name.className = 'appview-name';
  if (app.icon) { name.classList.add('has-icon'); name.append(svgUse(app.icon, 'tool-icon')); }
  if (app.color) name.style.setProperty('--c', app.color);
  name.append(document.createTextNode(label));
  const out = document.createElement('a');
  out.className = 'appview-out'; out.href = entry?.url || home(app);
  out.target = '_blank'; out.rel = 'noopener';
  out.dataset.outside = '';
  out.setAttribute('aria-label', w.outsideLabel(label));
  out.append(svgUse('i-external', 'ic'));
  const txt = document.createElement('span'); txt.className = 'appview-out-text'; txt.textContent = w.outside;
  out.append(txt);
  bar.append(b, name, out);
}

// The card shown instead of a frame on an isolated page: the app's name and the way to its tab.
function card(app, url) {
  const box = document.createElement('div');
  box.className = 'appview-card';
  const p = document.createElement('p');
  const a = document.createElement('a');
  a.className = 'btn appview-card-open'; a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.dataset.outside = '';
  box.append(p, a);
  box._paint = () => { p.textContent = words().isolated(app.name[lang()]); a.textContent = words().outside; };
  box._paint();
  return box;
}
function paintCards() { for (const e of loaded.values()) e.box?._paint?.(); }

// Tells a frame which hosts this page opens in place (the tool then routes its links here, see above).
function tell(entry) {
  const app = Object.values(BY_KEY).find((a) => loaded.get(a.key) === entry);
  if (!app || !entry.frame?.contentWindow) return;
  try { entry.frame.contentWindow.postMessage({ type: 'elffuss:embed', hosts: Object.keys(APPS) }, `https://${app.host}`); } catch { /* — */ }
}

function show(key, url) {
  build();
  const app = BY_KEY[key];
  let entry = loaded.get(key);
  if (!entry) {
    if (isolated()) {
      const box = card(app, url);
      frames.append(box);
      entry = { frame: null, box, url };
    } else {
      const frame = document.createElement('iframe');
      frame.className = 'appview-frame';
      frame.allow = ALLOW;
      frame.title = app.name[lang()];
      frame.src = url;
      frames.append(frame);
      entry = { frame, url };
      frame.addEventListener('load', () => tell(entry));
    }
    loaded.set(key, entry);
  }
  for (const [k, e] of loaded) (e.frame || e.box).hidden = k !== key;
  current = key;
  paintBar();
  view.hidden = false;
  document.getElementById('main').classList.add('has-app');
  onShow(key);
  (entry.frame || bar.querySelector('.appview-back'))?.focus({ preventScroll: true });
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
  const entry = loaded.get(key);
  // A link to another page of an app already open: that page, in the same frame.
  if (entry?.frame && url.href !== entry.url && url.pathname + url.search !== '/') { entry.frame.src = url.href; entry.url = url.href; }
  // One entry in the history over the chat, whichever apps were opened from there: «back» is always the chat.
  if (/^#app=/.test(location.hash)) { if (location.hash !== '#app=' + key) history.replaceState({ app: key }, '', '#app=' + key); }
  else history.pushState({ app: key }, '', '#app=' + key);
  show(key, entry?.url || (url.pathname === '/' && !url.search ? home(BY_KEY[key]) : url.href));
  return true;
}

// The app a link from another page names: ?tool=<name> (or ?app=), #app=<name> or #<name>.
export function linked(loc = location) {
  const q = new URLSearchParams(loc.search);
  const k = q.get('tool') || q.get('app') || (loc.hash.match(/^#(?:app=)?(\w+)$/) || [])[1];
  return k && Object.hasOwn(BY_KEY, k) ? k : null;
}

// The chat's address that opens the app a link points to, or null when it does not open inside the chat (another
// site, the public copy). For the links of other pages of this site (the apps page).
export function chatLink(href) {
  let url;
  try { url = new URL(href, location.href); } catch { return null; }
  if (mirror || url.protocol !== 'https:' || !Object.hasOwn(APPS, url.host)) return null;
  return '/?tool=' + APPS[url.host].key;
}

// The address decides: #app=<name> shows that app, anything else the chat.
function fromHash() {
  if (mirror) { hide(); return; }
  const m = location.hash.match(/^#app=(\w+)$/);
  if (m && BY_KEY[m[1]]) show(m[1], loaded.get(m[1])?.url || home(BY_KEY[m[1]]));
  else hide();
}

// A message from an app's frame: only from a frame of this page, from that frame's own origin.
function onMessage(e) {
  const entry = [...loaded.entries()].find(([, x]) => x.frame && x.frame.contentWindow === e.source);
  if (!entry) return;
  const [key, x] = entry;
  if (e.origin !== `https://${BY_KEY[key].host}`) return;
  const d = e.data;
  if (d?.type === 'elffuss:hello') { tell(x); return; }
  if (d?.type !== 'elffuss:open' || typeof d.href !== 'string') return;
  let url;
  try { url = new URL(d.href); } catch { return; }
  if (url.origin === location.origin) {
    // The chat itself (the Elffuss mark of a tool): back to it. Another page of this site: that page.
    if (url.pathname === '/' || url.pathname === '/index.html') back(); else location.assign(url.href);
    return;
  }
  if (!open(url.href)) window.open(url.href, '_blank', 'noopener');
}

export function start({ onChange } = {}) {
  if (onChange) onShow = onChange;
  addEventListener('popstate', fromHash);
  addEventListener('message', onMessage);
  const key = mirror ? null : linked();
  // A reload or a step back to #app=<name> already has the chat under it in the history.
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type;
  const arrived = nav !== 'reload' && nav !== 'back_forward' && !history.state?.app;
  if (key && (location.hash !== '#app=' + key || arrived)) {
    // A link from another page: the chat's clean address first, then the app over it.
    const clean = new URL(location.href);
    clean.searchParams.delete('tool'); clean.searchParams.delete('app'); clean.hash = '';
    history.replaceState(null, '', clean.pathname + clean.search);
    history.pushState({ app: key }, '', '#app=' + key);
  }
  if (/^#app=/.test(location.hash)) fromHash();
}
