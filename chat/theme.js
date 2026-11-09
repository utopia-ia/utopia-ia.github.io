// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// «Tu versión» of the chat, as DATA (elffuss-theme@1): a small JSON the user makes in Claw («ponte en verde», «más
// redondo») and that this page validates and applies with its own code. Never CSS and never code: nothing in a theme
// reaches a stylesheet, an attribute or the HTML parser.
//
// Where a theme comes from:
//   · Claw: the user's theme in Claw's own storage, read through Claw's bridge (bridge.js, op theme.get, read-only).
//     Kept here as a cache so the next visit paints it at once; the bridge's answer always wins (null clears it).
//   · A link from Code: https://elffuss.com/#theme=<base64url JSON>. Code cannot write Claw's storage, so it hands the
//     theme over in the address. The hash is removed at once; the theme is previewed and kept only after a click on
//     «Aplicar este aspecto», top-level, once per page load. A link can come from anyone, so its `texts` are dropped:
//     the words of the page only change from the user's own Claw.
// Of the two, the newest (`at`) is shown.
//
// How it is applied, and nothing else:
//   · validated AGAIN here with the canonical validator (js/elffuss-theme.js, pinned from Claw by chat-sync.sh), which
//     measures a partial theme against THIS page's official slate, so a theme that only changes some colours reads;
//   · colours, radii, spacing and the font only through document.documentElement.style.setProperty on the custom
//     properties of PROPS, each value checked again against its shape (#rrggbb, Npx, one of the local font stacks);
//   · three attributes on <html> chosen by this code, never copied from the theme: data-ef-yours (which parts are
//     themed), data-ef-scheme (light or dark wall) and data-ef-on-accent (light or dark text on the accent), so
//     chat.css can retune the few slate colours that are not tokens;
//   · texts only for the keys of THEMEABLE, each one audited to end in textContent or an attribute (never innerHTML,
//     never the model's prompt, never a message), and only through chat.js's t() (themeText below), plus the welcome
//     heading (welcomeTitle), set with textContent.
//
// The way back lives here, on elffuss.com: the slim note «Estás en tu versión · Volver a la oficial». «Volver a la
// oficial» turns it off in THIS browser (it is not deleted in Claw); a theme saved later shows again. ?official=1
// shows the official look for that visit. On the public copy (mirror.js) there are no themes at all.
import { validateTheme, themeProperties, themeTexts, textAllowed, contrast, FONTS, THEMEABLE, BASE, PAIRS } from './js/elffuss-theme.js';
import { mirror } from './mirror.js';

const root = document.documentElement;
const lang = () => (root.lang === 'es' ? 'es' : 'en');

// ---------- What a theme may touch ----------
export const PROPS = [
  '--ef-wall', '--ef-surface', '--ef-board', '--ef-steel', '--ef-ink', '--ef-graphite', '--ef-on-ink', '--ef-tape',
  '--ef-accent', '--ef-selection', '--ef-r1', '--ef-r2', '--ef-r3', '--ef-r4',
  '--ef-s1', '--ef-s2', '--ef-s3', '--ef-s4', '--ef-s5', '--ef-s6', '--ef-s7', '--ef-s8', '--ef-font',
];
const PROP_SET = new Set(PROPS);
const FONT_VALUES = new Set(Object.values(FONTS));
function valueOk(name, value) {
  if (typeof value !== 'string') return false;
  if (name === '--ef-font') return FONT_VALUES.has(value);
  if (/^--ef-[rs]\d$/.test(name)) return /^\d{1,3}px$/.test(value);
  return /^#[0-9a-f]{6}$/.test(value);
}

// The chat's words a theme may change (THEMEABLE), this page's official palette (BASE, the slate of slate.css) and the
// pairs it puts text on (PAIRS) live in the canonical file, so Claw refuses at saving what this page would refuse at
// applying. Each themeable key was audited here to end in textContent or an attribute: never innerHTML, a message or
// the model's prompt (the Markdown renderer would turn a themed «[x](https://…)» into a link). tests/theme.test.mjs
// checks it again on every run.
export { THEMEABLE };
export const SLATE = BASE;

// The canonical validator, then this page's own rules. `link`: a theme from an address (#theme=): no texts.
// → { ok, theme, errors, dropped }   `dropped`: texts were left out
export function prepare(input, { link = false } = {}) {
  let x = input, dropped = false;
  if (link) {
    if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return { ok: false, theme: null, errors: ['the theme is not valid JSON'], dropped }; } }
    if (x && typeof x === 'object' && !Array.isArray(x) && 'texts' in x) { x = { ...x }; delete x.texts; dropped = true; }
  }
  const v = validateTheme(x);
  if (!v.ok) return { ...v, dropped };
  const theme = v.theme;
  const c = { ...SLATE, ...(theme.colors || {}) };
  const errors = [];
  // Measured again here with the same pairs: what is applied is decided by this page, not by what Claw said.
  for (const [a, b, min] of PAIRS) if (contrast(c[a], c[b]) < min) errors.push(`${a} on ${b} is hard to read on elffuss.com (contrast ${contrast(c[a], c[b]).toFixed(1)}, needs ${min})`);
  if (errors.length) return { ok: false, theme: null, errors, dropped };
  // Texts: only the keys this page lets a theme change.
  if (theme.texts) {
    const texts = {};
    for (const l of ['en', 'es']) {
      const t = {};
      for (const [k, s] of Object.entries(themeTexts(theme, l))) if (THEMEABLE.has(k) && textAllowed(k)) t[k] = s;
      if (Object.keys(t).length) texts[l] = t;
    }
    if (Object.keys(texts).length) theme.texts = texts; else delete theme.texts;
  }
  return { ok: true, theme, errors: [], dropped };
}

// ---------- Applying ----------
let applied = null;                 // the theme on screen, or null
let texts = { en: {}, es: {} };
let onTexts = () => {};
const WELCOME = {};                 // the welcome heading's own words, per language, to put back

const isLight = (hex) => contrast(hex, '#000000') > contrast(hex, '#ffffff');

function clearProps() {
  for (const p of PROPS) root.style.removeProperty(p);
  delete root.dataset.efYours; delete root.dataset.efScheme; delete root.dataset.efOnAccent;
}

function apply(theme) {
  clearProps();
  applied = theme || null;
  const wasTexts = JSON.stringify(texts);
  texts = { en: {}, es: {} };
  if (theme) {
    for (const [name, value] of themeProperties(theme)) {
      if (PROP_SET.has(name) && valueOk(name, value)) root.style.setProperty(name, value);
    }
    const c = theme.colors || {};
    const parts = ['on'];
    if (['wall', 'surface', 'board', 'ink', 'graphite'].some((k) => c[k])) parts.push('palette');
    if (c.accent) parts.push('accent');
    root.dataset.efYours = parts.join(' ');
    root.dataset.efScheme = isLight(c.wall || SLATE.wall) ? 'light' : 'dark';
    if (c.accent) root.dataset.efOnAccent = contrast(c.accent, '#ffffff') >= contrast(c.accent, '#000000') ? 'light' : 'dark';
    for (const l of ['en', 'es']) for (const [k, s] of Object.entries(theme.texts?.[l] || {})) if (THEMEABLE.has(k) && textAllowed(k)) texts[l][k] = s;
  }
  paintWelcome();
  if (JSON.stringify(texts) !== wasTexts) onTexts();
}

// What chat.js's t() asks first: a themed label, or undefined.
export function themeText(l, key) {
  if (!THEMEABLE.has(key)) return undefined;
  const s = texts[l === 'es' ? 'es' : 'en'][key];
  return typeof s === 'string' ? s : undefined;
}

function paintWelcome() {
  for (const span of document.querySelectorAll('.welcome h1 [data-l]')) {
    const l = span.dataset.l === 'es' ? 'es' : 'en';
    if (!(l in WELCOME)) WELCOME[l] = span.textContent;
    span.textContent = texts[l].welcomeTitle ?? WELCOME[l];
  }
}

// ---------- Where it is kept ----------
const K = { claw: 'elffuss.theme.claw', local: 'elffuss.theme.local', off: 'elffuss.theme.off' };
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const offAt = () => { const v = Number(read(K.off)); return Number.isFinite(v) ? v : 0; };

// A stored entry, validated again (it is only this browser's storage, but it was written by another visit).
function entry(k, { link = false } = {}) {
  const e = read(k);
  if (!e || typeof e !== 'object') return null;
  const v = prepare(e.theme, { link });
  return v.ok ? { theme: v.theme, at: Number(e.at) || 0, from: k === K.claw ? 'claw' : 'link' } : null;
}

let refused = null;                 // { at } of a Claw theme this page could not apply
function pick() {
  const off = offAt();
  const all = [entry(K.claw), entry(K.local, { link: true })].filter((e) => e && e.at > off);
  all.sort((a, b) => b.at - a.at);
  return all[0] || null;
}

// ---------- The note at the top ----------
const WORDS = {
  en: {
    on: 'You are on your version', back: 'Back to the official',
    backDone: 'You are on the official version. Yours is still kept in Claw; the next one you save shows here.',
    refused: 'Your version was not applied here: its colours would be hard to read. You are on the official version.',
    close: 'Close',
    pvTitle: 'Use this look?', pvBody: 'It came in a link. You are seeing it now; nothing is kept until you accept it.',
    pvTexts: 'Texts only change from Claw: the ones in this link are not used.',
    pvYes: 'Apply this look', pvNo: 'No',
    pvBad: 'This link has a look that cannot be used here.',
  },
  es: {
    on: 'Estás en tu versión', back: 'Volver a la oficial',
    backDone: 'Estás en la versión oficial. La tuya sigue guardada en Claw; la próxima que guardes se verá aquí.',
    refused: 'Tu versión no se ha aplicado aquí: sus colores no se leerían bien. Ves la versión oficial.',
    close: 'Cerrar',
    pvTitle: '¿Usar este aspecto?', pvBody: 'Te ha llegado en un enlace. Ya lo estás viendo; no se guarda nada hasta que lo aceptes.',
    pvTexts: 'Los textos solo se cambian desde Claw: los de este enlace no se usan.',
    pvYes: 'Aplicar este aspecto', pvNo: 'No',
    pvBad: 'Este enlace trae un aspecto que no se puede usar aquí.',
  },
};
const w = () => WORDS[lang()];

let note = null;
let noteState = null;               // 'on' | 'done' | 'refused' | null
let doneTimer = 0;
function paintNote() {
  if (!noteState) { note?.remove(); note = null; return; }
  if (!note) {
    note = document.createElement('div');
    note.id = 'yours-note';
    note.className = 'yours-note';
    note.setAttribute('role', 'status');
    // Under the top bar, so it never sits in a phone's notch.
    const bar = document.querySelector('#main > .topbar');
    if (bar) bar.after(note); else (document.getElementById('main') || document.body).prepend(note);
  }
  note.dataset.state = noteState;
  note.replaceChildren();
  const text = document.createElement('span');
  text.className = 'yours-text';
  if (noteState === 'on') {
    const dot = document.createElement('span');
    dot.className = 'yours-dot'; dot.setAttribute('aria-hidden', 'true');
    text.append(dot, document.createTextNode(w().on));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'yours-back'; b.textContent = w().back;
    b.addEventListener('click', backToOfficial);
    note.append(text, b);
  } else {
    text.textContent = noteState === 'done' ? w().backDone : w().refused;
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'yours-x'; x.setAttribute('aria-label', w().close);
    x.append(xIcon());
    x.addEventListener('click', () => {
      if (noteState === 'refused' && refused) write('elffuss.theme.seen', refused.at);
      noteState = null; paintNote();
    });
    note.append(text, x);
  }
}
function xIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-close');
  s.append(u);
  return s;
}

function backToOfficial(e) {
  if (e && !e.isTrusted) return;
  write(K.off, Date.now());
  apply(null);
  noteState = 'done';
  paintNote();
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { if (noteState === 'done') { noteState = null; paintNote(); } }, 9000);
}

function show(p) {
  apply(p ? p.theme : null);
  if (noteState !== 'done') noteState = p ? 'on' : (refused && refused.at > offAt() && Number(read('elffuss.theme.seen')) !== refused.at ? 'refused' : null);
  paintNote();
}

// ---------- A theme in the address (#theme=, from Code) ----------
const MAX_LINK = 8 * 1024;
export function decodeLink(payload) {
  if (typeof payload !== 'string' || !payload) return { ok: false, errors: ['empty'] };
  if (payload.length > MAX_LINK) return { ok: false, errors: [`the link is too long (${payload.length} characters, at most ${MAX_LINK})`] };
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(payload)) return { ok: false, errors: ['not base64url'] };
  let json;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch { return { ok: false, errors: ['not base64url UTF-8'] }; }
  return prepare(json, { link: true });
}

let previewed = false;
let card = null;
function preview(v) {
  previewed = true;
  card = document.createElement('section');
  card.className = 'yours-preview';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'yours-pv-h');
  const end = (keep) => {
    removeEventListener('hashchange', onNav); removeEventListener('popstate', onNav); removeEventListener('keydown', onKey);
    card?.remove(); card = null;
    if (keep) { write(K.local, { theme: v.theme, at: Date.now() }); noteState = null; }
    show(pick());
  };
  const onNav = () => end(false);
  const onKey = (e) => { if (e.key === 'Escape') end(false); };
  const paint = () => {
    card.replaceChildren();
    const h = document.createElement('h2'); h.id = 'yours-pv-h';
    const p = document.createElement('p');
    const acts = document.createElement('div'); acts.className = 'yours-pv-acts';
    if (!v.ok) {
      h.textContent = w().pvTitle; p.textContent = w().pvBad;
      const x = document.createElement('button'); x.type = 'button'; x.className = 'mini-btn'; x.textContent = w().close;
      x.addEventListener('click', () => end(false));
      acts.append(x);
      card.append(h, p, acts);
      return;
    }
    h.textContent = w().pvTitle; p.textContent = w().pvBody;
    card.append(h, p);
    if (v.dropped) { const q = document.createElement('p'); q.className = 'yours-pv-note'; q.textContent = w().pvTexts; card.append(q); }
    const no = document.createElement('button'); no.type = 'button'; no.className = 'mini-btn'; no.textContent = w().pvNo;
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn yours-pv-yes'; yes.textContent = w().pvYes;
    // Only a real click on this page: no script, no frame around it.
    no.addEventListener('click', (e) => { if (e.isTrusted) end(false); });
    yes.addEventListener('click', (e) => { if (e.isTrusted && window.top === window) end(true); });
    acts.append(no, yes);
    card.append(acts);
  };
  paint();
  card._paint = paint;
  (document.getElementById('main') || document.body).append(card);
  if (v.ok) apply(v.theme);
  addEventListener('hashchange', onNav); addEventListener('popstate', onNav); addEventListener('keydown', onKey);
  card.querySelector('.yours-pv-yes, .mini-btn')?.focus({ preventScroll: true });
}

function takeLink() {
  const m = /^#theme=(.*)$/s.exec(location.hash);
  if (!m) return null;
  // Out of the address at once: not in the history, not in a bookmark, not sent on.
  history.replaceState(history.state, '', location.pathname + location.search);
  return m[1];
}

// ---------- Start ----------
// `bridge`: bridge.js. `onTexts`: called when the themed words change (chat.js repaints with applyLang).
export const official = () => { try { return new URLSearchParams(location.search).get('official') === '1'; } catch { return false; } };
export function startTheme({ bridge, onTexts: cb = () => {}, timeoutMs = 4000 } = {}) {
  onTexts = cb;
  new MutationObserver(() => { paintNote(); card?._paint?.(); }).observe(root, { attributes: true, attributeFilter: ['lang'] });
  const link = takeLink();
  if (mirror || official()) return Promise.resolve(null);
  if (link != null && !previewed && window.top === window) preview(decodeLink(link));
  if (!card) show(pick());
  // Claw's answer: the theme it keeps (validated there, and again here), or none.
  const ask = bridge.call('theme.get').then((r) => ({ r }), (e) => ({ e }));
  const late = new Promise((res) => setTimeout(() => res({ late: true }), timeoutMs));
  return Promise.race([ask, late]).then((x) => {
    if (x.late || x.e?.code === 'bridge-down') return applied;     // not known now: what was shown stays
    const got = x.e ? null : x.r;
    refused = null;
    if (got && typeof got === 'object' && got.theme) {
      const v = prepare(got.theme);
      if (v.ok) write(K.claw, { theme: v.theme, at: Number(got.at) || 0 });
      else { write(K.claw, null); refused = { at: Number(got.at) || 0 }; console.info('[chat] your version was not applied:', v.errors.join('; ')); }
    } else write(K.claw, null);
    if (!card) show(pick());
    return applied;
  });
}

export const active = () => applied;
