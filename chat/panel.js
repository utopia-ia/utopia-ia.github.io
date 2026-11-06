// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The app panel: the app the model built, running next to the conversation. On a computer it is a column to the right
// of the chat that can be widened or narrowed and taken full screen; on a phone it opens over the chat as a sheet with
// a close button.
//
// The app runs in a sandboxed frame from a srcdoc, never with this page's origin: no allow-same-origin, so it cannot
// read this page, its storage or Claw's; no popups and no navigation of this page. Claw's viewer allows scripts,
// forms, modals, popups and downloads; this one drops popups and downloads, and adds a Content-Security-Policy that
// is the first thing in the document, before any of the app's own markup: no network at all (connect, images, fonts
// and media only from data: and blob:, forms post nowhere).

import { clawAppUrl } from './bridge.js';
import { mirror } from './mirror.js';

export const SANDBOX = 'allow-scripts allow-forms allow-modals';
export const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; " +
  "frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'";

// After the policy, a few lines that tell this page when the app fails (a script error, a rejected promise): a small
// model sometimes writes an app with a bug, and the panel then offers to ask for a fix. It sends only the error text.
const REPORTER = '<script>(function(){var n=0;function s(m){if(n++>4)return;try{parent.postMessage({kind:"elffuss-app-error",message:String(m||"error").slice(0,300)},"*")}catch(e){}}' +
  'addEventListener("error",function(e){s(e.message)});addEventListener("unhandledrejection",function(e){s(e.reason&&e.reason.message||e.reason)})})()</script>';

// The policy goes right after the doctype (or first, without one), so it is in force before the app's first script.
export function withCsp(html) {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}">` + REPORTER;
  const m = /^\s*(<!doctype[^>]*>)/i.exec(html);
  return m ? m[1] + head + html.slice(m[0].length) : head + html;
}

const $ = (id) => document.getElementById(id);
const narrow = () => matchMedia('(max-width: 899px)').matches;
const WIDTH_KEY = 'elffuss-home.panel-w';

let ui = null;
let current = null;            // { name, html, saved }
let opener = null;
let words = (k) => k;
let changed = () => {};

export const openName = () => current?.name || null;
export const openHtml = () => current?.html || null;
export const isOpen = () => !!current;

export function init({ t, onChange, onFix }) {
  words = t; changed = onChange || changed;
  ui = {
    app: $('app'), panel: $('app-panel'), frame: $('app-frame'), name: $('app-panel-name'), state: $('app-panel-state'),
    claw: $('app-open-claw'), full: $('app-full'), close: $('app-close'), grip: $('app-grip'),
    err: $('app-err'), errText: $('app-err-text'), fix: $('app-fix'),
  };
  ui.frame.setAttribute('sandbox', SANDBOX);
  // Only the running app's own frame, only this one kind of message, shown as text.
  addEventListener('message', (e) => {
    if (!current || e.source !== ui.frame.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.kind !== 'elffuss-app-error' || typeof m.message !== 'string') return;
    if (!ui.err.hidden) return;                      // the first error is the one worth fixing
    current.error = m.message.slice(0, 300);
    paintErr();
  });
  ui.fix.addEventListener('click', () => { if (current?.error && onFix) onFix(current.name, current.error); });
  ui.close.addEventListener('click', close);
  ui.full.addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', paintFull);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !current) return;
    if (ui.panel.classList.contains('is-max') && !document.fullscreenElement) { setMax(false); return; }
    if (narrow() && !document.fullscreenElement) close();
  });
  try { const w = +localStorage.getItem(WIDTH_KEY); if (w > 0) setWidth(w); } catch { /* — */ }
  grip();
}

export function repaint() {
  if (!ui) return;
  for (const [b, k] of [[ui.claw, 'openInClaw'], [ui.close, 'closeApp']]) { b.setAttribute('aria-label', words(k)); b.title = words(k); }
  paintFull();
  if (current) paintState();
}

export function show(app, { from = null } = {}) {
  current = { name: app.name, html: app.html, saved: !!app.saved };
  opener = from || document.activeElement;
  ui.name.textContent = app.name;
  ui.frame.title = app.name;
  ui.err.hidden = true;
  ui.frame.srcdoc = withCsp(app.html);
  paintState();
  ui.panel.hidden = false;
  ui.app.classList.add('has-panel');
  if (narrow()) { document.body.classList.add('panel-sheet'); ui.close.focus({ preventScroll: true }); }
  changed();
}

// The same app saved again (a newer version, or its saved state changed): repaint without moving focus.
export function refresh(app) {
  if (!current || current.name !== app.name) return;
  show({ ...current, ...app }, { from: opener });
}

export function markSaved(name, saved) {
  if (current && current.name === name) { current.saved = saved; paintState(); }
}

export function close() {
  if (!current) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setMax(false);
  current = null;
  ui.frame.srcdoc = '';
  ui.panel.hidden = true;
  ui.app.classList.remove('has-panel');
  document.body.classList.remove('panel-sheet');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
  changed();
}

export const lastError = () => current?.error || null;
function paintErr() {
  if (!current?.error) { ui.err.hidden = true; return; }
  ui.errText.textContent = words('appError', current.error);
  ui.fix.textContent = words('fixIt');
  ui.err.hidden = false;
}

function paintState() {
  if (current?.error) paintErr();
  const saved = current?.saved;
  ui.state.textContent = saved ? words('panelSaved') : words('panelNotSaved');
  ui.state.dataset.saved = String(!!saved);
  ui.claw.hidden = !saved || mirror;   // the copy (mirror.js) does not share apps with Claw
  if (saved) ui.claw.href = clawAppUrl(current.name);
  ui.claw.setAttribute('aria-label', words('openInClaw'));
  ui.claw.title = words('openInClaw');
  ui.close.setAttribute('aria-label', words('closeApp'));
  ui.close.title = words('closeApp');
  paintFull();
}

// Full screen: the browser's own when it offers it (the header stays, with its close button); where it does not
// (Safari on iPhone only does it for video), the panel covers the window.
function toggleFull() {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  if (ui.panel.classList.contains('is-max')) { setMax(false); return; }
  if (ui.panel.requestFullscreen) ui.panel.requestFullscreen().catch(() => setMax(true));
  else setMax(true);
}
function setMax(on) { ui.panel.classList.toggle('is-max', on); paintFull(); }
function paintFull() {
  if (!ui) return;
  const on = !!document.fullscreenElement || ui.panel.classList.contains('is-max');
  const label = on ? words('exitFull') : words('fullScreen');
  ui.full.setAttribute('aria-label', label);
  ui.full.title = label;
  ui.full.setAttribute('aria-pressed', String(on));
  ui.full.querySelector('use')?.setAttribute('href', on ? '#i-shrink' : '#i-expand');
}

// The grip between the chat and the panel: drag it, or focus it and use the arrow keys.
function setWidth(px) {
  const max = Math.max(360, innerWidth - 288 - 380);
  const w = Math.round(Math.min(Math.max(px, 340), max));
  ui.app.style.setProperty('--panel-w', w + 'px');
  ui.grip.setAttribute('aria-valuenow', String(w));
  return w;
}
function saveWidth(w) { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* — */ } }
function grip() {
  const g = ui.grip;
  g.setAttribute('aria-valuemin', '340');
  let startX = 0, startW = 0;
  const move = (e) => { setWidth(startW + (startX - e.clientX)); };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    document.body.classList.remove('is-resizing');
    saveWidth(ui.panel.getBoundingClientRect().width);
  };
  g.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX; startW = ui.panel.getBoundingClientRect().width;
    document.body.classList.add('is-resizing');
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  g.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 96 : 32;
    const w = ui.panel.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') { e.preventDefault(); saveWidth(setWidth(w + step)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); saveWidth(setWidth(w - step)); }
  });
}
