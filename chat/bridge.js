// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The chat's link to Claw's own storage for the user's APPS. Claw (claw.elffuss.com) keeps them in its IndexedDB;
// its page bridge.html, loaded here in a hidden frame, reads and writes them for this page (apps.* only). elffuss.com
// and claw.elffuss.com are the same site, so the frame opens Claw's real storage, not a partitioned copy: what the
// chat saves, Claw sees, and the reverse. The memory is not here: it is the engine's shared memory (memory-wire.js),
// with its own store page.
//
// If the frame does not answer (offline, blocked, a browser that partitions it), the bridge is 'down' and every call
// fails with 'bridge-down'. Nothing is ever written anywhere else instead.
//
// The one exception is the public copy of the chat (mirror.js): there Claw's page is never loaded (it answers only
// https://elffuss.com, and the copy exists for networks that block elffuss.com), and the same apps.* operations run
// on this browser's own storage (local.js). Nothing waits for a frame there.
import { mirror } from './mirror.js';
import * as local from './local.js';

export const CLAW = 'https://claw.elffuss.com';
const KIND = 'elffuss-bridge';
const READY_MS = 8000;
const CALL_MS = 10000;
const RETRY_MS = 15000;

let frame = null;
let state = 'idle';                 // idle | loading | ready | down
let connecting = null;
let lastTry = 0;
let seq = 0;
const pending = new Map();
const listeners = new Set();
let onReady = null;

export const status = () => state;
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(s) { if (s === state) return; state = s; for (const fn of listeners) { try { fn(s); } catch { /* — */ } } }

addEventListener('message', (e) => {
  if (e.origin !== CLAW || !frame || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object' || m.kind !== KIND || m.v !== 1) return;
  if (m.op === 'ready') { onReady?.(); return; }
  const p = typeof m.id === 'string' && pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  clearTimeout(p.timer);
  if (m.ok === true) p.resolve(m.result);
  else p.reject(Object.assign(new Error(String(m.error || 'failed')), { code: String(m.error || 'failed') }));
});

// Loads the frame once. Resolves true when Claw's page has said it is ready, false when it has not within READY_MS.
export function connect() {
  if (state === 'ready') return Promise.resolve(true);
  if (mirror) {
    if (!connecting) connecting = local.available().then((ok) => { connecting = null; setState(ok ? 'ready' : 'down'); return ok; });
    return connecting;
  }
  if (connecting) return connecting;
  if (state === 'down' && Date.now() - lastTry < RETRY_MS) return Promise.resolve(false);
  lastTry = Date.now();
  setState('loading');
  connecting = new Promise((resolve) => {
    frame?.remove();
    frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.title = 'Claw storage';
    // Scripts and its own origin's storage, nothing else: no popups, no navigation of this page, no forms.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    const done = (ok) => {
      clearTimeout(timer); onReady = null; connecting = null;
      if (!ok) { frame?.remove(); frame = null; }
      setState(ok ? 'ready' : 'down');
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), READY_MS);
    onReady = () => done(true);
    frame.src = CLAW + '/bridge.html';
    document.body.append(frame);
  });
  return connecting;
}

export async function call(op, args = {}) {
  if (!(await connect())) throw Object.assign(new Error('bridge-down'), { code: 'bridge-down' });
  if (mirror) return local.call(op, args);
  const id = 'c' + (++seq).toString(36) + Math.random().toString(36).slice(2, 8);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A frame that stopped answering is treated as gone: the next call loads it again.
      frame?.remove(); frame = null; setState('down');
      reject(Object.assign(new Error('bridge-down'), { code: 'bridge-down' }));
    }, CALL_MS);
    pending.set(id, { resolve, reject, timer });
    frame.contentWindow.postMessage({ kind: KIND, v: 1, id, op, args }, CLAW);
  });
}

export const clawAppUrl = (name) => `${CLAW}/#/apps/${encodeURIComponent(name)}`;
