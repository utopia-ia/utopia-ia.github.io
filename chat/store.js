// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Chats, kept in this browser only (IndexedDB). Nothing here is sent anywhere. If the browser refuses storage
// (some private windows), the chats live in memory for this visit and `persistent` says so.

const DB = 'elffuss-home';
const STORE = 'chats';
let dbp = null;
const memory = new Map();
export let persistent = true;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { persistent = false; resolve(null); return; }
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { persistent = false; resolve(null); };
    req.onblocked = () => { persistent = false; resolve(null); };
  });
  return dbp;
}

function run(mode, fn) {
  return open().then((db) => {
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

export async function list() {
  const all = await run('readonly', (s) => (s ? s.getAll() : { result: [...memory.values()] }));
  return (all || []).sort((a, b) => b.updated - a.updated);
}

export async function get(id) {
  if (!id) return null;
  const c = await run('readonly', (s) => (s ? s.get(id) : { result: memory.get(id) }));
  return c || null;
}

export async function put(chat) {
  const copy = JSON.parse(JSON.stringify(chat));
  await run('readwrite', (s) => (s ? s.put(copy) : (memory.set(copy.id, copy), null)));
}

export async function remove(id) {
  await run('readwrite', (s) => (s ? s.delete(id) : (memory.delete(id), null)));
}
