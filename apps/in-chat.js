// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The apps page's links to an app or tool that opens inside the chat (chat/appview.js: Image, Video, Audio,
// Translator, Copilot, Claw, Braid) open it there, at /?tool=<name>, instead of leaving elffuss.com: installed as an
// app, Elffuss stays in its own window. The links keep their real address (for a new tab, a search engine, no
// script, or the public copy, where chatLink() says no).
//
// Not when the chat is isolated on this device (its service worker coi-sw.js controls the site): an isolated chat
// cannot frame the apps, so the link goes to the app as before. And not for a click with a modifier key, which is
// the visitor's own choice of tab or window.
//
// In the capture phase: before the page's own handler that opens links to other sites in a new window when Elffuss
// is installed as an app.
import { chatLink } from '../chat/appview.js';

const coi = () => /\/coi-sw\.js$/.test(navigator.serviceWorker?.controller?.scriptURL || '');

addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || a.target === '_blank' || coi()) return;
  const to = chatLink(a.href);
  if (!to) return;
  e.preventDefault();
  location.assign(to);
}, true);
