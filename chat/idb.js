// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// One IndexedDB connection for the visit that survives the browser closing it. Safari closes a page's connections
// on its own (a tab asleep in the background, memory pressure, storage evicted) and from then on every
// db.transaction() throws «The database connection is closing». So the connection is forgotten when it closes or
// another tab asks for a new version, and a transaction that could not start, or that the browser aborted, runs ONCE
// more on a new connection. That never writes twice: an aborted transaction commits nothing, and a transaction that
// fails for its own reasons (a bad key, the quota) is not retried.

const LOST = new Set(['InvalidStateError', 'AbortError', 'UnknownError']);

// open() → Promise of a new IDBDatabase, or of null when this browser keeps nothing (that null is kept for the visit).
// Returns run(fn): fn(db) starts one transaction and returns its promise; run returns what fn's promise gives.
export function connection(open) {
  let current = null;
  const forget = (p) => { if (current === p) current = null; };
  const connect = () => {
    if (current) return current;
    const p = current = Promise.resolve().then(open).then((db) => {
      if (db) {
        db.onclose = () => forget(p);
        db.onversionchange = () => { db.close(); forget(p); };
      }
      return db;
    });
    p.catch(() => forget(p));
    return p;
  };
  return async function run(fn) {
    for (let retried = false; ; retried = true) {
      const p = connect();
      const db = await p;
      try {
        return await fn(db);
      } catch (e) {
        if (retried || !db || !LOST.has(e?.name)) throw e;
        forget(p);
        try { db.close(); } catch { /* already closing */ }
      }
    }
  };
}

// One transaction on one store: fn(objectStore) makes the requests and returns the one whose result is wanted.
// Resolves with that result when the transaction has completed (so a write is on disk), rejects if it aborts.
export function transaction(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onabort = () => reject(t.error || Object.assign(new Error('transaction aborted'), { name: 'TransactionAborted' }));
  });
}
