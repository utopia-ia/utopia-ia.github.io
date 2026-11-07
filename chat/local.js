// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The user's apps kept in THIS browser, for the public copy of the chat (see mirror.js). On elffuss.com they live in
// Claw's storage, reached through Claw's bridge page; on the copy that page is not reachable (another site, or a
// network that blocks elffuss.com), so the same operations run here, on this origin's own IndexedDB. (The memory is
// not here: memory-wire.js runs the engine's own store in the page.)
//
// The operations, arguments, records and checks are those of Claw's bridge (web/js/bridge.js in elffuss-claw):
// apps {name, html, created}, the same rule for the generic names «app» and «boceto». So the chat code does not know
// which one answers. Nothing here is ever sent anywhere.

import { connection, transaction } from './idb.js';

const DB = 'elffuss-home-local';
const MAX_NAME = 80;
const MAX_HTML = 512 * 1024;
const RE_CONTROL = /[\u0000-\u001f\u007f]/;

const fail = (code) => Object.assign(new Error(code), { code });
const need = (cond, code = 'bad-request') => { if (!cond) throw fail(code); };
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const nameOk = (x) => text(x, MAX_NAME) && !RE_CONTROL.test(x);

// Reopened if the browser closes it (see idb.js).
const withDb = connection(() => new Promise((resolve, reject) => {
  let req;
  try { req = indexedDB.open(DB, 1); } catch { reject(fail('bridge-down')); return; }
  req.onupgradeneeded = () => { req.result.createObjectStore('apps', { keyPath: 'name' }); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = req.onblocked = () => reject(fail('bridge-down'));
}));
const tx = (store, mode, fn) => withDb((d) => transaction(d, store, mode, fn)).catch((e) => {
  throw e?.code === 'bridge-down' ? e : fail('bridge-down');
});
const all = (s) => tx(s, 'readonly', (o) => o.getAll());
const get = (s, k) => tx(s, 'readonly', (o) => o.get(k));
const put = (s, v) => tx(s, 'readwrite', (o) => o.put(v));
const del = (s, k) => tx(s, 'readwrite', (o) => o.delete(k));

const OPS = {
  'apps.list': async () => (await all('apps')).map((a) => ({ name: a.name, created: a.created || 0, bytes: String(a.html || '').length })),
  'apps.get': async ({ name }) => {
    need(nameOk(name));
    const a = await get('apps', name);
    need(a && typeof a.html === 'string', 'not-found');
    return { name: a.name, html: a.html, created: a.created || 0 };
  },
  'apps.save': async ({ name, html }) => {
    need(nameOk(name));
    need(typeof html === 'string' && html.length > 0);
    need(html.length <= MAX_HTML, 'too-large');
    if (name === 'app' || name === 'boceto') {
      let n = name, i = 1;
      while (await get('apps', n)) n = `${name}-${++i}`;
      name = n;
    }
    const replaced = !!(await get('apps', name));
    const created = Date.now();
    await put('apps', { name, html, created });
    return { name, created, replaced };
  },
  'apps.remove': async ({ name }) => {
    need(nameOk(name));
    const existed = !!(await get('apps', name));
    await del('apps', name);
    return { name, existed };
  },
};

// Is this browser's storage usable? (A private window or a blocked site storage says no.)
export async function available() {
  try { await withDb(() => null); return true; } catch { return false; }
}

export async function call(op, args = {}) {
  need(Object.hasOwn(OPS, op), 'bad-request');
  return OPS[op](args || {});
}
