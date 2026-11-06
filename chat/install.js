// The offer to install elffuss.com as an app. Installed, the browser gives the site storage it does not clear after a
// few days without use, so the model stays saved; the chat also opens in its own window, full screen on a phone.
//
// Where the browser has its own install dialog (Chrome and Edge, on computers and on Android) the button opens it.
// Where it does not, the offer says the steps: Share and «Add to Home Screen» on iPhone and iPad, «Add to Dock» in
// Safari on a Mac. Firefox on a computer cannot install a site, so nothing is offered there.
//
// On a phone it is the first thing offered. On a computer only when the browser can do it. «Not now» holds until
// the tab is closed.

// Installed is anything but a browser tab: an app window may report standalone, minimal-ui, fullscreen or
// window-controls-overlay depending on how it was installed, and asking only for standalone missed some of them.
const installed = () => !matchMedia('(display-mode: browser)').matches || navigator.standalone === true;
const phone = () => navigator.userAgentData?.mobile === true
  || (matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches);
const iOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const macSafari = () => !iOS() && /Macintosh/.test(navigator.userAgent) && /Version\/\d+.*Safari/.test(navigator.userAgent)
  && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent);
const SKIP = 'elffuss.install.no';

const T = {
  en: {
    title: 'Install Elffuss as an app',
    why: 'The browser keeps the model saved instead of clearing it after a few days without use, and the chat opens in its own window.',
    whyApart: 'The app keeps the model in its own storage, apart from the browser, and never clears it after days without use. Install it before the first answer: the model then downloads once, inside the app.',
    install: 'Install',
    ios: 'Tap Share, then «Add to Home Screen».',
    mac: 'In the File menu, choose «Add to Dock».',
    other: 'Open the browser menu and choose «Add to Home screen».',
    later: 'Not now',
  },
  es: {
    title: 'Instala Elffuss como app',
    why: 'El navegador guarda el modelo en vez de borrarlo tras unos días sin usarlo, y el chat se abre en su propia ventana.',
    whyApart: 'La app guarda el modelo en su propio almacén, aparte del navegador, y no lo borra aunque pasen días sin usarla. Instálala antes de la primera respuesta: así el modelo se descarga una sola vez, ya dentro de la app.',
    install: 'Instalar',
    ios: 'Pulsa Compartir y luego «Añadir a pantalla de inicio».',
    mac: 'En el menú Archivo, elige «Añadir al Dock».',
    other: 'Abre el menú del navegador y elige «Añadir a pantalla de inicio».',
    later: 'Ahora no',
  },
};
const words = () => T[document.documentElement.lang === 'es' ? 'es' : 'en'];

let box = null;
let deferred = null;     // Chrome's event, kept so the button can open its dialog

function show() {
  if (box || !document.body) return;
  box = document.createElement('div');
  box.className = 'install';
  box.setAttribute('role', 'dialog');
  const paint = () => {
    const w = words();
    box.setAttribute('aria-label', w.title);
    box.innerHTML = '';
    const h = document.createElement('p'); h.className = 'install-title'; h.textContent = w.title;
    // On iPhone, iPad and Safari on a Mac the installed app does not see the browser's storage: a model downloaded in
    // the tab would download again inside the app. There the box says so, so it can be installed first.
    const p = document.createElement('p'); p.className = 'install-why'; p.textContent = iOS() || macSafari() ? w.whyApart : w.why;
    const row = document.createElement('div'); row.className = 'install-row';
    if (deferred) {
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn'; ok.textContent = w.install;
      ok.addEventListener('click', async () => {
        const e = deferred; deferred = null; hide();
        try { await e.prompt(); } catch { /* the browser declined to show it */ }
      });
      row.append(ok);
    } else {
      const how = document.createElement('p'); how.className = 'install-how'; how.textContent = iOS() ? w.ios : macSafari() ? w.mac : w.other;
      row.append(how);
    }
    const no = document.createElement('button'); no.type = 'button'; no.className = 'mini-btn'; no.textContent = w.later;
    no.addEventListener('click', () => { try { sessionStorage.setItem(SKIP, '1'); } catch { /* private mode */ } hide(); });
    row.append(no);
    box.append(h, p, row);
  };
  paint();
  box._lang = new MutationObserver(paint);
  box._lang.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // In the page's flow, under the chat's top bar, so it pushes the chat down instead of covering what is loading.
  const bar = document.querySelector('#main > .topbar');
  if (bar) bar.after(box); else { box.classList.add('is-floating'); document.body.append(box); }
}
function hide() { if (!box) return; box._lang.disconnect(); box.remove(); box = null; }

// The menu offers it always while the site is not installed, also after «Not now» and on browsers with no dialog
// of their own (there the entry opens the same box with the steps). «Not now» only stops the box from coming by itself.
function wireEntry() {
  const entry = document.getElementById('install-entry');
  if (!entry) return;
  entry.hidden = false;
  entry.addEventListener('click', async () => {
    if (deferred) {
      const e = deferred; deferred = null; hide();
      try { await e.prompt(); } catch { /* the browser declined to show it */ }
      return;
    }
    hide(); show();
    box?.querySelector('button')?.focus({ preventScroll: true });
  });
  addEventListener('appinstalled', () => { entry.hidden = true; });
}

export function offerInstall() {
  if (installed()) { navigator.storage?.persist?.().catch(() => {}); return; }
  wireEntry();
  let skipped = false;
  try { skipped = sessionStorage.getItem(SKIP) === '1'; } catch { /* private mode */ }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!skipped) { hide(); show(); } });
  addEventListener('appinstalled', () => { hide(); navigator.storage?.persist?.().catch(() => {}); });
  if (skipped) return;
  if (iOS() || macSafari()) show();
  else if (phone()) setTimeout(() => { if (!deferred) show(); }, 2500);
}
