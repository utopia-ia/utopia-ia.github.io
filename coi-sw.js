// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Isolates the chat page (COOP/COEP) on devices that run the model on the processor, so the engine can share memory
// between threads and use two or more cores: on a tablet without WebGPU that was ×1.6 reading and writing. The chat
// registers this worker only when it runs on the CPU and unregisters it when a usable WebGPU appears.
//
// Only the chat page (the scope's own path) is isolated; any other page of the site loads as before. Same-origin
// subresources get the headers an isolated page and its workers need; cross-origin requests pass untouched (the
// model comes from Hugging Face with CORS, which an isolated page may read).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) {
    // Safari loses the Range header when it follows the model's redirect (Hugging Face to its CDN) for a page that
    // has a service worker: it answered 200 with the whole file instead of 206. Made from here, the request keeps it.
    if (r.headers.has('range')) e.respondWith(fetch(r.url, { headers: r.headers, mode: 'cors', credentials: 'omit', redirect: 'follow', signal: r.signal }));
    return;
  }
  const base = new URL(self.registration.scope).pathname;
  const nav = r.mode === 'navigate';
  // The lab page (chat/lab.html) is isolated too: it measures the engine's threads on the processor.
  if (nav && u.pathname !== base && u.pathname !== base + 'index.html' && u.pathname !== base + 'chat/lab.html') return;
  e.respondWith(fetch(r).then((res) => {
    if (res.status === 0 || res.type === 'opaqueredirect') return res;
    const h = new Headers(res.headers);
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (nav) h.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }));
});
