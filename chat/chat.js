// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The elffuss.com chat: a model running in this browser with the Elffuss engine answers. The model, its name and its
// size come from the engine's registry (js/engine/registro.js), never from this file. Nothing is downloaded until
// the visitor presses the download button, and nothing the visitor types is sent anywhere except a web search the
// model makes (web.js, the search words or one address, shown on its card): the engine runs here and the chats are
// kept in this browser (store.js).
//
// The model has Claw's tools for apps and the engine's memory tools (tools.js): it builds a small web app that runs at
// once in the panel next to the chat (panel.js), and remembers what the user asks it to. The apps are kept in Claw's
// own storage in this browser, reached through Claw's bridge page (bridge.js). The memory is the one memory every
// Elffuss app shares, kept only in this browser by its store page (memory-wire.js): each turn gets only the facts
// relevant to it, within a budget set by the model's context, and nothing is saved unless the user said it.

import * as store from './store.js';
import { render } from './md.js';
import { MODELS, cachea } from './js/engine/registro.js';
import * as bridge from './bridge.js';
import * as panel from './panel.js';
import * as memory from './memory-wire.js';
import { offerInstall } from './install.js';
import * as web from './web.js';
import * as appview from './appview.js';
import { mirror, WORDS as MIRROR_WORDS, mountNote } from './mirror.js';
import { parseToolCall, writingTool, systemPrompt, contextBlock, withContext, CONTEXT_LABEL } from './tools.js';

const $ = (id) => document.getElementById(id);

offerInstall();

// A link to another Elffuss app. The ones that work in a frame open inside this page (appview.js), the rest
// (Code, Tools) outside. Installed as an app, «outside» must be said with window.open: a plain link to another
// origin would open inside this window, under the browser's own bar with the address, which no page can hide.
addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  let url;
  try { url = new URL(a.href, location.href); } catch { return; }
  if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
  if (!a.hasAttribute('data-outside') && appview.embeddable(url)) {
    e.preventDefault();
    closeSide();
    if (ui.sheet?.open) ui.sheet.close();
    appview.open(url.href);
    return;
  }
  if (!(matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)) return;
  e.preventDefault();
  window.open(url.href, '_blank', 'noopener');
});
const root = document.documentElement;
let lang = root.lang === 'es' ? 'es' : 'en';
const locale = () => (lang === 'es' ? 'es-ES' : 'en-US');

// ---------- Words ----------
const T = {
  en: {
    title: 'Elffuss · Chat with an AI that runs in your browser',
    newChat: 'New chat',
    gateTitle: 'Download the model to get an answer',
    gateBody: (label) => `${label} answers on this device. Your browser downloads it once and keeps it for your next visit.`,
    gateBtn: (size) => `Download ${size}`,
    bytes: (n) => `${n} bytes`,
    starting: 'Starting the graphics card…',
    downloading: (a, b, p) => `Downloading the model · ${a} of ${b} · ${p} %`,
    downloadingPct: (p) => `Downloading the model · ${p} %`,
    gpu: (p) => `Loading the model onto the graphics card · ${p} %`,
    gpuNet: (p) => `Loading the model onto the graphics card · ${p} % · read from the network, not saved`,
    cpu: (p) => `Loading the model into the processor · ${p} %`,
    lbNotSaved: 'Not saved',
    notSaved: 'This browser could not save the model, so your next visit will download it again.',
    notSavedSpace: (free) => `This browser could not save the model, so your next visit will download it again. Usually the disk is almost full${free ? ` (the browser has ${free} left)` : ''}: free some space, or install Elffuss as an app, which gives it room that is not cleared.`,
    lbDownload: 'Download',
    lbHere: 'Already in this browser',
    lbLoad: 'Load onto the graphics card',
    story: (label, size, cached) => [
      ['No server is answering you.', 'The replies are written on this device, by its own graphics card. What you type stays here, except a web search you ask for.'],
      cached
        ? ['The model was already in this browser.', '0 bytes from the network. It only has to go from disk to the graphics card.']
        : ['You are downloading the whole model.', `${label}, ${size}. Only this once: on your next visit it is read from this browser, with 0 bytes from the network.`],
      ['On an engine we wrote ourselves.', 'Elffuss Engine writes up to 1.8 times faster than other engines, with the same model in the same browser.'],
      ['No account, no key, no bill per message.', 'There is nobody in the middle to charge you for it.'],
      ['Tested before every release.', 'Every version of the engine passes more than 200 tests, 86 of them checked against llama.cpp.'],
    ],
    fromDisk: 'Reading the model from this browser · 0 bytes to download',
    index: 'Reading the model index…',
    ready: 'Model ready',
    stCached: 'In this browser · 0 bytes to download',
    stMissing: (size) => `${size} to download, once`,
    stReady: 'Ready on this device',
    stLoading: 'Loading…',
    fineCached: (label) => `${label} is already in this browser: 0 bytes to download. It runs on this device, and chats are kept in this browser only.`,
    fineReady: (label) => `${label} is loaded and runs on this device. Chats are kept in this browser only.`,
    fineMissing: (label, size) => `The first answer needs a one-time download of ${label}, ${size}. It runs on this device, and chats are kept in this browser only.`,
    fineCpu: 'This browser has no usable WebGPU, so the model runs on the processor: slower than on a graphics card.',
    thinking: 'Thinking…',
    reading: (n) => `Reading · ${n}%`,
    reasoning: 'Reasoning',
    stopped: 'Stopped',
    cut: 'The model used its whole thinking budget before writing an answer. It can answer straight away instead, more briefly.',
    noAnswer: 'No answer: the model was not downloaded.',
    errSpace: 'The model could not be downloaded. Usually there is not enough free disk space, or the connection dropped. Free some space and try again.',
    errTab: 'Another Elffuss tab has this model loaded. Close that tab and try again.',
    errGpu: 'This browser has no WebGPU available.',
    errMemory: 'There is not enough graphics memory for this model on this device.',
    errBinding: 'This browser does not allow buffers large enough for this model.',
    errLost: 'The graphics card was reset and the model was unloaded. Send your message again to reload it.',
    errGeneric: 'The model could not answer.',
    retry: 'Try again',
    noReason: 'Answer without reasoning',
    details: 'Details',
    delAsk: 'Delete this chat?',
    delYes: 'Delete',
    delNo: 'Keep',
    delLabel: (t) => `Delete “${t}”`,
    noPersist: 'This browser is not letting the page keep chats, so they will be gone when you close it.',
    whyNoWebgpu: 'Detail: this browser has no WebGPU.',
    whyNoAdapter: 'Detail: WebGPU is present but offers no graphics adapter.',
    whyNoF16: 'Detail: the graphics adapter lacks 16-bit shader support (shader-f16), which the engine needs.',
    whyFallback: 'Detail: WebGPU offers only a software adapter here.',
    // Apps, memory and the panel
    buildingApp: (n) => `Building the app · ${n} ${n === 1 ? 'line' : 'lines'}`,
    usingTool: 'Using a tool…',
    saving: 'Saving…',
    appNew: 'New app',
    appUpdated: 'App updated',
    appOpened: 'App opened',
    appSavedLine: 'Saved in your apps, shared with Claw',
    appNotSavedLine: 'Runs here, not saved: Claw’s storage is not available',
    appDeniedLine: 'Runs here, not saved: saving was not allowed',
    open: 'Open',
    openInClaw: 'Open in Claw',
    closeApp: 'Close the app',
    fullScreen: 'Full screen',
    exitFull: 'Exit full screen',
    panelSaved: 'Saved · shared with Claw',
    panelNotSaved: 'Not saved',
    memList: 'What Elffuss remembers',
    memTitle: 'Memory',
    appList: 'Your apps',
    webSearching: 'Searching the web…',
    webSearched: 'Searched the web',
    webReading: 'Reading the page…',
    webRead: 'Read the page',
    webSentSearch: 'Only these search words left this device, to DuckDuckGo.',
    webSentUrl: 'Only this address left this device, to read the page.',
    appNone: 'No apps yet.',
    appsDown: 'Your apps are not available right now: Claw’s storage does not answer.',
    toolFailed: 'The tool did not work',
    askApps: 'Save this app in your apps?',
    askAppsBody: 'Apps made here are kept in Claw, in this browser, and listed under Your apps. It runs here either way. You are asked once.',
    allow: 'Allow',
    deny: 'Not now',
    mineEmpty: 'Apps you build here or in Claw show up here.',
    mineDown: 'Not available: Claw’s storage does not answer.',
    mineMore: (n) => `${n} more in Claw`,
    memCount: (n) => (n === 0 ? 'Remembers nothing yet' : n === 1 ? 'Remembers 1 thing' : `Remembers ${n} things`),
    memBtnOn: 'Memory on in this chat: it uses and saves what you ask it to remember. Press to turn it off here.',
    memBtnOff: 'Memory off in this chat: it neither reads nor saves memories. Press to turn it on.',
    forgetLearnt: (n) => (n === 1 ? 'Also forget the 1 thing I learnt here' : `Also forget the ${n} things I learnt here`),
    forgetFailed: 'I could not forget what I learnt here, so the chat is still here. Try again in a moment.',
    listKept: '(The list was shown to the user. Call memory.list again if you need it.)',
    anythingElse: 'Anything else?',
    cutTool: 'The model ran out of room before it finished. Ask again, perhaps for something smaller.',
    appError: (m) => `The app hit an error: ${m}`,
    fixIt: 'Ask to fix it',
    fixAsk: (name, m) => `The app “${name}” shows this error: ${m}. Fix it.`,
  },
  es: {
    title: 'Elffuss · Chatea con una IA que corre en tu navegador',
    newChat: 'Nueva conversación',
    gateTitle: 'Descarga el modelo para recibir la respuesta',
    gateBody: (label) => `${label} responde en este dispositivo. El navegador lo descarga una vez y lo guarda para la próxima visita.`,
    gateBtn: (size) => `Descargar ${size}`,
    bytes: (n) => `${n} bytes`,
    starting: 'Encendiendo la tarjeta gráfica…',
    downloading: (a, b, p) => `Descargando el modelo · ${a} de ${b} · ${p} %`,
    downloadingPct: (p) => `Descargando el modelo · ${p} %`,
    gpu: (p) => `Cargando el modelo en la tarjeta gráfica · ${p} %`,
    gpuNet: (p) => `Cargando el modelo en la tarjeta gráfica · ${p} % · leído de la red, sin guardar`,
    cpu: (p) => `Cargando el modelo en el procesador · ${p} %`,
    lbNotSaved: 'Sin guardar',
    notSaved: 'Este navegador no ha podido guardar el modelo, así que en la próxima visita se volverá a descargar.',
    notSavedSpace: (free) => `Este navegador no ha podido guardar el modelo, así que en la próxima visita se volverá a descargar. Suele ser el disco casi lleno${free ? ` (al navegador le quedan ${free})` : ''}: libera espacio, o instala Elffuss como app, que le da un sitio que no se borra.`,
    lbDownload: 'Descargar',
    lbHere: 'Ya está en este navegador',
    lbLoad: 'Cargar en la tarjeta gráfica',
    story: (label, size, cached) => [
      ['Aquí no contesta ningún servidor.', 'Las respuestas se escriben en este dispositivo, con su propia tarjeta gráfica. Lo que escribes no sale de aquí, salvo las búsquedas web que le pidas.'],
      cached
        ? ['El modelo ya estaba en este navegador.', '0 bytes de red. Solo tiene que pasar del disco a la tarjeta gráfica.']
        : ['Estás bajando el modelo entero.', `${label}, ${size}. Solo esta vez: en la próxima visita se lee de este navegador, con 0 bytes de red.`],
      ['Con un motor hecho por nosotros.', 'Elffuss Engine escribe hasta 1,8 veces más rápido que otros motores, con el mismo modelo y en el mismo navegador.'],
      ['Sin cuenta, sin clave y sin pagar por mensaje.', 'No hay nadie en medio que te lo cobre.'],
      ['Probado antes de cada versión.', 'Cada versión del motor pasa más de 200 pruebas, 86 de ellas comparadas con llama.cpp.'],
    ],
    fromDisk: 'Leyendo el modelo de este navegador · 0 bytes que descargar',
    index: 'Leyendo el índice del modelo…',
    ready: 'Modelo listo',
    stCached: 'En este navegador · 0 bytes que descargar',
    stMissing: (size) => `${size} que descargar, una vez`,
    stReady: 'Listo en este dispositivo',
    stLoading: 'Cargando…',
    fineCached: (label) => `${label} ya está en este navegador: 0 bytes que descargar. Corre en este dispositivo y las conversaciones se guardan solo en este navegador.`,
    fineReady: (label) => `${label} está cargado y corre en este dispositivo. Las conversaciones se guardan solo en este navegador.`,
    fineMissing: (label, size) => `La primera respuesta necesita descargar una vez ${label}, ${size}. Corre en este dispositivo y las conversaciones se guardan solo en este navegador.`,
    fineCpu: 'Este navegador no tiene WebGPU utilizable, así que el modelo corre en el procesador: más despacio que en una tarjeta gráfica.',
    thinking: 'Pensando…',
    reading: (n) => `Leyendo · ${n} %`,
    reasoning: 'Razonamiento',
    stopped: 'Parada',
    cut: 'El modelo agotó todo su margen para pensar antes de escribir la respuesta. Puede responder directamente, de forma más breve.',
    noAnswer: 'Sin respuesta: no se descargó el modelo.',
    errSpace: 'No se pudo descargar el modelo. Suele ser falta de espacio en disco o una conexión que se ha cortado. Libera espacio y vuelve a intentarlo.',
    errTab: 'Otra pestaña de Elffuss tiene este modelo cargado. Ciérrala y vuelve a intentarlo.',
    errGpu: 'Este navegador no tiene WebGPU disponible.',
    errMemory: 'No hay memoria gráfica suficiente para este modelo en este dispositivo.',
    errBinding: 'Este navegador no permite búferes tan grandes como necesita este modelo.',
    errLost: 'La tarjeta gráfica se ha reiniciado y el modelo se ha descargado de ella. Vuelve a enviar el mensaje para cargarlo otra vez.',
    errGeneric: 'El modelo no ha podido responder.',
    retry: 'Reintentar',
    noReason: 'Responder sin razonar',
    details: 'Detalles',
    delAsk: '¿Borrar esta conversación?',
    delYes: 'Borrar',
    delNo: 'Conservar',
    delLabel: (t) => `Borrar «${t}»`,
    noPersist: 'Este navegador no deja que la página guarde las conversaciones, así que se perderán al cerrarla.',
    whyNoWebgpu: 'Detalle: este navegador no tiene WebGPU.',
    whyNoAdapter: 'Detalle: hay WebGPU, pero no ofrece ningún adaptador gráfico.',
    whyNoF16: 'Detalle: el adaptador gráfico no admite shaders de 16 bits (shader-f16), que el motor necesita.',
    whyFallback: 'Detalle: aquí WebGPU solo ofrece un adaptador por software.',
    buildingApp: (n) => `Construyendo la app · ${n} ${n === 1 ? 'línea' : 'líneas'}`,
    usingTool: 'Usando una herramienta…',
    saving: 'Guardando…',
    appNew: 'App nueva',
    appUpdated: 'App actualizada',
    appOpened: 'App abierta',
    appSavedLine: 'Guardada en tus apps, compartida con Claw',
    appNotSavedLine: 'Funciona aquí, sin guardar: el almacén de Claw no está disponible',
    appDeniedLine: 'Funciona aquí, sin guardar: no se permitió guardarla',
    open: 'Abrir',
    openInClaw: 'Abrir en Claw',
    closeApp: 'Cerrar la app',
    fullScreen: 'Pantalla completa',
    exitFull: 'Salir de pantalla completa',
    panelSaved: 'Guardada · compartida con Claw',
    panelNotSaved: 'Sin guardar',
    memList: 'Lo que recuerda Elffuss',
    memTitle: 'Memoria',
    appList: 'Tus apps',
    webSearching: 'Buscando en la web…',
    webSearched: 'Búsqueda en la web',
    webReading: 'Leyendo la página…',
    webRead: 'Página leída',
    webSentSearch: 'Solo estas palabras han salido de este dispositivo, hacia DuckDuckGo.',
    webSentUrl: 'Solo esta dirección ha salido de este dispositivo, para leer la página.',
    appNone: 'Aún no hay apps.',
    appsDown: 'Tus apps no están disponibles ahora: el almacén de Claw no responde.',
    toolFailed: 'La herramienta no ha funcionado',
    askApps: '¿Guardar esta app en tus apps?',
    askAppsBody: 'Las apps que se hacen aquí se guardan en Claw, en este navegador, y aparecen en Tus apps. Funciona aquí igualmente. Se pregunta una sola vez.',
    allow: 'Permitir',
    deny: 'Ahora no',
    mineEmpty: 'Aquí aparecen las apps que construyas aquí o en Claw.',
    mineDown: 'No disponible: el almacén de Claw no responde.',
    mineMore: (n) => `${n} más en Claw`,
    memCount: (n) => (n === 0 ? 'Aún no recuerda nada' : n === 1 ? 'Recuerda 1 cosa' : `Recuerda ${n} cosas`),
    memBtnOn: 'Memoria activada en esta conversación: usa y guarda lo que le pidas recordar. Pulsa para apagarla aquí.',
    memBtnOff: 'Memoria apagada en esta conversación: ni lee ni guarda recuerdos. Pulsa para encenderla.',
    forgetLearnt: (n) => (n === 1 ? 'Olvidar también la cosa que aprendí aquí' : `Olvidar también las ${n} cosas que aprendí aquí`),
    forgetFailed: 'No he podido olvidar lo que aprendí aquí, así que el chat sigue aquí. Inténtalo dentro de un momento.',
    listKept: '(La lista se le mostró al usuario. Vuelve a llamar a memory.list si la necesitas.)',
    anythingElse: '¿Algo más?',
    cutTool: 'El modelo se quedó sin margen antes de terminar. Pídelo otra vez, quizá algo más pequeño.',
    appError: (m) => `La app ha dado un error: ${m}`,
    fixIt: 'Pedir que lo arregle',
    fixAsk: (name, m) => `La app «${name}» da este error: ${m}. Arréglalo.`,
  },
};
// The public copy (mirror.js) keeps memory and apps in this browser and has no web search: its own words.
if (mirror) for (const l of ['en', 'es']) Object.assign(T[l], MIRROR_WORDS[l]);
const t = (k, ...a) => { const v = T[lang][k] ?? T.en[k]; return typeof v === 'function' ? v(...a) : v; };

const gb = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n / 1e9) + ' GB';
const mb = (n) => (n >= 1e9 ? gb(n) : new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(n / 1e6) + ' MB');
const num = (n) => new Intl.NumberFormat(locale()).format(n);

// Things painted with words that must follow a language switch.
const repaints = new Set();
const live = (fn) => { fn(); repaints.add(fn); return fn; };

// ---------- State ----------
const ui = {
  main: $('main'), thread: $('thread'), scroller: $('scroller'), input: $('composer-input'), form: $('composer'),
  send: $('send'), stop: $('stop'), fine: $('fine'), model: $('model'), modelName: $('model-name'), modelState: $('model-state'),
  list: $('chat-list'), empty: $('chats-empty'), side: $('side'), scrim: $('scrim'), sheet: $('apps-sheet'),
};
const device = { ok: null, id: null, why: '', cpu: false };
const narrow = () => matchMedia('(max-width: 899px)').matches;
let modelState = 'checking';        // checking | missing | cached | loading | ready
let engine = null;
let loading = null;                  // the load promise, shared by every turn
let progressSink = null;             // where the load progress is painted right now
let chat = null;                     // the open chat
let markDetected, markChecked;
const detected = new Promise((r) => { markDetected = r; });   // the device has been looked at
const checked = new Promise((r) => { markChecked = r; });     // and the store asked whether the model is there
let turn = null;                     // { ctl, chatId } while a turn is running
const CURRENT = 'elffuss-home.chat';

// On the public copy the Q8_0 is read from Hugging Face instead of m1.elffuss.com: the copy has to work where
// elffuss.com is blocked. It is the same file, byte for byte (sha256 8f6b2418…20b6, LiquidAI/LFM3-1.7B-GGUF), at
// the revision the Q4_0 is already pinned to; `bytes` is checked against it. The shared store (models.elffuss.com)
// is skipped for the whole visit: model-store.js reads this flag before it would embed the store.
const HF_LFM3 = 'https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF';
const HF_REV = 'bad5729bba61d076fff20d2548e62526665af215';
if (mirror) {
  const q8 = MODELS['lfm3-1.7b'];
  if (q8 && q8.bytes === 1846238496) {
    q8.url = `${HF_LFM3}/resolve/${HF_REV}/LFM3-1.7B-Q8_0.gguf`;
    q8.licencia = `${HF_LFM3}/blob/${HF_REV}/LICENSE`;
  } else if (q8 && !/^https:\/\/huggingface\.co\//.test(String(q8.url))) {
    // The registry's Q8_0 is no longer the file above: offer the Q4_0 (already on Hugging Face) rather than a host
    // the copy cannot count on.
    delete MODELS['lfm3-1.7b'];
  }
  try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* the store then fails on its own */ }
}
// An answer without reasoning may run to 3,000 tokens, not the registry's 512: a small app is one whole HTML document,
// and at 512 it came out cut in the middle of its form (measured on a phone, with a health-record app).
for (const id of ['lfm3-1.7b', 'lfm3-1.7b-q4']) if (MODELS[id]) MODELS[id].tope = Math.max(MODELS[id].tope || 0, 3000);

// The system prompt of this chat is fixed, so the engine may keep its snapshot on disk: the next visit starts from
// there instead of reading the whole system prompt again before the first letter (engine provider.js, «prefijo de
// sistema en disco»). Claw and Code leave it off: their system block changes at every step.
globalThis.__ELFFUSS_PREFIJO_DISCO = true;
const model = () => (device.id ? MODELS[device.id] : null);
const modelUrl = () => { const m = model(); return m && !Array.isArray(m.url) ? m.url : null; };

// ---------- Device ----------
// Without a usable WebGPU the engine runs the QAD-Q4_0 on the processor (WebAssembly SIMD, in a Worker): slower than
// the graphics card, but it answers instead of showing «this browser cannot». The probe is the smallest module that
// uses a SIMD instruction; a browser without SIMD fails it and keeps the old screen.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const cpuCan = () => { try { return typeof Worker === 'function' && WebAssembly.validate(SIMD_PROBE); } catch { return false; } };
// `?cpu` in the address forces the processor even where WebGPU works: to try, on any device, what a browser without
// it gets.
const FORCE_CPU = /[?&]cpu(=|&|$)/.test(location.search);
async function pickDevice() {
  if (FORCE_CPU && cpuCan() && MODELS['lfm3-1.7b-q4']) return { ok: true, id: 'lfm3-1.7b-q4', cpu: true, why: '' };
  const r = await pickGpu();
  if (r.ok || !cpuCan() || !MODELS['lfm3-1.7b-q4']) return r;
  return { ok: true, id: 'lfm3-1.7b-q4', cpu: true, why: r.why };
}
async function pickGpu() {
  if (!navigator.gpu) return { ok: false, why: 'whyNoWebgpu' };
  let a = null;
  try { a = await navigator.gpu.requestAdapter(); } catch { /* none */ }
  if (!a) return { ok: false, why: 'whyNoAdapter' };
  if (a.info?.isFallbackAdapter || a.isFallbackAdapter) return { ok: false, why: 'whyFallback' };
  if (!a.features?.has('shader-f16')) return { ok: false, why: 'whyNoF16' };
  // The same rule as Claw and Code: the Q8_0 on a computer whose adapter allows a 1 GiB buffer, the QAD-Q4_0 on a
  // phone (or a narrow or touch window, as the apps decide it), where the Q8_0 does not fit in the tab.
  const phone = matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches;
  if (!phone && (a.limits?.maxBufferSize || 0) >= 2 ** 30 && MODELS['lfm3-1.7b']) return { ok: true, id: 'lfm3-1.7b' };
  if (MODELS['lfm3-1.7b-q4']) return { ok: true, id: 'lfm3-1.7b-q4' };
  return { ok: false, why: 'whyNoAdapter' };
}

// Is the model already stored? The shared store of the Elffuss sites first, then this site's own copy. Neither
// question downloads any weights.
const keyFor = (url) => String(url).replace(/[?#].*$/, '').replace(/[^\w.\-]+/g, '_').slice(-180);
async function isCached() {
  const m = model(); const url = modelUrl();
  if (!m || !url || !cachea(m)) return false;
  if (!mirror) try {
    const { isSharedCached } = await import('./js/runtime/model-broker.js');
    if (await isSharedCached(url)) return true;
  } catch { /* the shared store is not reachable */ }
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
    await dir.getFileHandle(keyFor(url) + '.done');
    return true;
  } catch { return false; }
}

let wasCached = false;               // what the store said before this load started
function setModelState(s) {
  if (s === 'cached') wasCached = true;
  if (s === 'missing') wasCached = false;
  modelState = s;
  ui.model.dataset.state = s;
  paintModel();
}
function paintModel() {
  const m = model();
  if (!m) return;
  ui.model.hidden = false;
  ui.modelName.textContent = m.label + (device.cpu ? ' · CPU' : '');
  const size = gb(m.bytes);
  ui.modelState.textContent = modelState === 'ready' ? t('stReady')
    : modelState === 'loading' ? t('stLoading')
    : modelState === 'cached' ? t('stCached')
    : modelState === 'missing' ? t('stMissing', size) : '';
  // The line under the box only speaks when there is something to know before sending: a download still to come.
  // Once the model is here it said the same thing on every message, and read as a warning nobody could act on.
  // On the processor it also says why the answers come slower, until the model is loaded.
  const fine = [
    modelState === 'missing' || (modelState === 'loading' && !wasCached) ? t('fineMissing', m.label, size) : null,
    device.cpu && modelState !== 'ready' ? t('fineCpu') : null,
  ].filter(Boolean).join(' ') || null;
  ui.fine.hidden = !fine;
  if (fine) {
    ui.fine.textContent = fine;
    if (!store.persistent) ui.fine.textContent += ' ' + t('noPersist');
  }
}
repaints.add(paintModel);

function showNoGpu(why) {
  document.body.classList.add('no-gpu');
  ui.main.classList.add('no-gpu');
  $('nogpu').hidden = false;
  live(() => { $('nogpu-why').textContent = t(why); });
  $('nogpu-apps').append(appListClone());
  for (const el of document.querySelectorAll('[data-new-chat], .chats')) el.hidden = true;
}

// ---------- Chats ----------
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const titleOf = (text) => { const s = text.replace(/\s+/g, ' ').trim(); return s.length > 60 ? s.slice(0, 57) + '…' : s; };

async function paintList() {
  const all = await store.list();
  ui.list.textContent = '';
  ui.empty.hidden = all.length > 0;
  for (const c of all) {
    const li = document.createElement('li');
    li.className = 'chat-item';
    if (chat && c.id === chat.id) li.setAttribute('aria-current', 'true');
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'chat-open'; open.textContent = c.title || t('newChat');
    open.addEventListener('click', () => { openChat(c.id); closeSide(); });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'chat-del';
    del.setAttribute('aria-label', t('delLabel', c.title || t('newChat')));
    del.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>';
    del.addEventListener('click', () => confirmDelete(li, c));
    li.append(open, del);
    ui.list.append(li);
  }
}
repaints.add(paintList);

// Deleting a chat that taught the memory something offers to forget that too: unchecked, with the facts listed, so
// nothing leaves the memory unless the user ticks it.
function confirmDelete(li, c) {
  li.textContent = '';
  const box = document.createElement('div');
  box.className = 'chat-confirm';
  const q = document.createElement('span'); q.textContent = t('delAsk');
  const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'mini-btn danger'; yes.textContent = t('delYes');
  const no = document.createElement('button'); no.type = 'button'; no.className = 'mini-btn'; no.textContent = t('delNo');
  let forget = null;
  let failNote = null;
  yes.addEventListener('click', async () => {
    if (turn && turn.chatId === c.id) await stopTurn();
    if (forget?.checked && c.memConv) {
      // The chat goes only if what it taught went too: once deleted, its conversation id is lost and «forget what
      // this chat taught» could never be done again. A store that is down, a rate limit or a missing grant keep it.
      const r = await memory.forgetLearntIn(c.memConv).catch(() => null);
      if (!r || r.ok === false) {
        if (!failNote) { failNote = el('span', 'forget-failed'); failNote.setAttribute('role', 'alert'); box.append(failNote); }
        failNote.textContent = t('forgetFailed');
        return;
      }
    }
    await store.remove(c.id);
    if (chat && chat.id === c.id) startNew();
    paintList();
  });
  no.addEventListener('click', () => paintList());
  box.append(q, yes, no);
  li.append(box);
  no.focus();
  // The chat as stored now: the list may have been painted before its first turn gave it a memory conversation id.
  if (memory.loaded()) {
    store.get(c.id).then((now) => (now?.memConv ? (c.memConv = now.memConv, memory.learntIn(now.memConv)) : null)).then((r) => {
      if (!r || !r.count || !box.isConnected) return;
      const label = el('label', 'forget-learnt');
      forget = el('input'); forget.type = 'checkbox';
      label.append(forget, el('span', null, t('forgetLearnt', r.count)));
      const ul = el('ul', 'forget-items');
      // Every fact the box would forget is listed (the list scrolls when long): nothing goes unseen.
      for (const f of r.items) ul.append(el('li', null, f));
      box.append(label, ul);
    }).catch(() => {});
  }
}

async function startNew() {
  if (turn) await stopTurn();
  chat = null;
  pendingIncognito = false;
  paintMemToggle();
  try { localStorage.removeItem(CURRENT); } catch { /* — */ }
  ui.thread.textContent = '';
  ui.main.classList.add('is-empty');
  paintList();
  ui.input.focus();
}

async function openChat(id) {
  if (chat && chat.id === id) return;
  if (turn) await stopTurn();
  const c = await store.get(id);
  if (!c) return startNew();
  chat = c;
  try { localStorage.setItem(CURRENT, id); } catch { /* — */ }
  paintMemToggle();
  ui.thread.textContent = '';
  for (const m of c.messages) {
    if (m.meta === 'result') continue;           // what a tool answered the model: shown by its card, not as a bubble
    if (m.role === 'user') appendUser(m.content);
    else { const li = appendBot(); paintBot(li, m); paintMemCard(li, m); }
  }
  ui.main.classList.toggle('is-empty', c.messages.length === 0);
  paintList();
  scrollEnd(true);
}

async function save() {
  if (!chat) return;
  chat.updated = Date.now();
  await store.put(chat);
}

// ---------- Thread ----------
function nearEnd() { const s = ui.scroller; return s.scrollHeight - s.scrollTop - s.clientHeight < 120; }
function scrollEnd(force) { if (force || nearEnd()) ui.scroller.scrollTop = ui.scroller.scrollHeight; }

function appendUser(text) {
  const li = document.createElement('li');
  li.className = 'msg msg-user';
  const b = document.createElement('div');
  b.className = 'bubble'; b.textContent = text;
  li.append(b);
  ui.thread.append(li);
  return li;
}

function appendBot() {
  const li = document.createElement('li');
  li.className = 'msg msg-bot';
  ui.thread.append(li);
  return li;
}

// While the model reads the prompt, the live pill fills with how much of it it has read. The first word repaints the
// message and the pill goes back to «Thinking…».
function paintReading(li, done, total) {
  const think = li.querySelector('.think.is-live');
  if (!think || !(total > 0)) return;
  const n = Math.min(100, Math.floor(done / total * 100));
  think.classList.add('is-reading');
  think.style.setProperty('--read', n + '%');
  think.querySelector('summary').textContent = t('reading', n);
}

// One assistant message: optional reasoning (folded), the answer, and a stamp if it was stopped.
function paintBot(li, m, { writing = false, thinkingLive = false } = {}) {
  let think = li.querySelector('.think');
  if (m.thinking && m.thinking.trim()) {
    if (!think) {
      think = document.createElement('details');
      think.className = 'think';
      think.innerHTML = '<summary></summary><div class="think-body"></div>';
      li.prepend(think);
    }
    think.classList.toggle('is-live', thinkingLive);
    think.classList.remove('is-reading');
    think.querySelector('summary').textContent = thinkingLive ? t('thinking') : t('reasoning');
    think.querySelector('.think-body').textContent = m.thinking.trim();
  } else if (thinkingLive) {
    if (!think) {
      think = document.createElement('details');
      think.className = 'think is-live';
      think.innerHTML = '<summary></summary><div class="think-body"></div>';
      li.prepend(think);
    }
    think.classList.remove('is-reading');
    think.querySelector('summary').textContent = t('thinking');
  } else if (think) think.remove();

  let ans = li.querySelector('.answer');
  if (!ans) { ans = document.createElement('div'); ans.className = 'answer'; li.append(ans); }
  li._msg = m;
  // A step that called a tool shows its card, never the call itself (a whole HTML page, or a JSON block). While the
  // model is still writing one, the words before it stay and a progress line replaces the code.
  const wt = m.call ? null : writingTool(m.content || '');
  if (m.call) {
    ans.innerHTML = '';
    paintCard(li, m);
  } else if (wt && writing) {
    ans.innerHTML = render(wt.before);
    const s = document.createElement('p');
    s.className = 'building';
    s.setAttribute('aria-live', 'polite');
    s.textContent = wt.kind === 'app' ? t('buildingApp', wt.lines) : t('usingTool');
    ans.append(s);
  } else {
    li.querySelector('.tool-card')?.remove();
    ans.innerHTML = render(m.content || '');
  }
  ans.classList.toggle('is-writing', writing && !!m.content && !wt && !m.call);

  li.querySelector('.stamp')?.remove();
  li.querySelector('.note')?.remove();
  if (m.stopped) {
    const s = document.createElement('span'); s.className = 'stamp'; s.textContent = t('stopped'); li.append(s);
  }
  if (m.note) {
    const n = document.createElement('p'); n.className = 'note'; n.textContent = t(m.note); li.append(n);
  }
}

// ---------- Tool cards ----------
const svg = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function clawLink(href, label) {
  const a = el('a', 'tc-link');
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.innerHTML = svg('i-external');
  a.append(document.createTextNode(label));
  return a;
}

// The card a tool step leaves in the conversation, painted from what is stored with the message (call + result), so
// a reloaded chat shows the same card in either language.
function paintCard(li, m) {
  const r = m.result || { pending: true };
  const c = m.call || {};
  let card = li.querySelector('.tool-card');
  if (!card) { card = el('div', 'tool-card'); li.querySelector('.answer').after(card); }
  card.textContent = '';
  card.className = 'tool-card';
  const body = el('div', 'tc-body');

  if (c.tool === 'app.create' || c.tool === 'app.open') {
    card.classList.add('card-app');
    card.insertAdjacentHTML('afterbegin', svg('i-window', 'ic tc-ic'));
    const name = r.name || c.name || 'app';
    body.append(el('span', 'tc-kicker', r.error ? t('toolFailed') : c.tool === 'app.open' ? t('appOpened') : r.replaced ? t('appUpdated') : t('appNew')));
    body.append(el('b', 'tc-title', name));
    const line = r.pending ? t('saving') : r.error ? r.error : r.saved ? t('appSavedLine') : r.denied ? t('appDeniedLine') : t('appNotSavedLine');
    body.append(el('span', 'tc-line', line));
    card.append(body);
    if (!r.pending && !r.error) {
      const acts = el('div', 'tc-actions');
      const b = el('button', 'mini-btn tc-open', t('open'));
      b.type = 'button';
      b.addEventListener('click', () => openApp(name, m, b));
      acts.append(b);
      if (r.saved && !mirror) acts.append(clawLink(bridge.clawAppUrl(name), t('openInClaw')));
      card.append(acts);
    }
    if (r.error) card.classList.add('is-error');
    return;
  }
  if (String(c.tool).startsWith('memory.')) {
    // The memory's own card (engine, memory-cards.js), with its buttons while they still mean something: Undo, Yes,
    // Forget. A card from an earlier visit only says what happened.
    card.classList.add('card-mem');
    if (r.pending) {
      card.insertAdjacentHTML('afterbegin', svg('i-note', 'ic tc-ic'));
      body.append(el('span', 'tc-kicker', t('usingTool')));
      card.append(body);
      return;
    }
    card.classList.add('is-engine');
    const slot = el('div', 'mem-slot');
    if (c.tool === 'memory.list') {
      card.insertAdjacentHTML('afterbegin', svg('i-note', 'ic tc-ic'));
      body.append(el('span', 'tc-kicker', t('memList')));
      card.classList.remove('is-engine');
      card.append(body);
      const acts = el('div', 'tc-actions');
      const b = el('button', 'mini-btn', t('memTitle'));
      b.type = 'button';
      b.addEventListener('click', () => openMemory(b));
      acts.append(b);
      card.append(acts);
      return;
    }
    card.append(slot);
    // A chat from before the shared memory stored {fact, id} instead of a card: it shows as what happened then.
    const legacy = !r.card && r.fact && !r.error && !r.down && !r.denied
      ? (c.tool === 'memory.forget' ? { type: 'forgotten' } : { type: 'saved', fact: r.fact }) : null;
    paintMemSlot(slot, li, m, r.card || legacy);
    return;
  }
  if (c.tool === 'app.list') {
    card.classList.add('card-list');
    card.insertAdjacentHTML('afterbegin', svg('i-window', 'ic tc-ic'));
    body.append(el('span', 'tc-kicker', t('appList')));
    if (r.down) body.append(el('span', 'tc-line', t('appsDown')));
    else if (r.error) body.append(el('span', 'tc-line', r.error));
    else if (!r.pending) {
      const items = r.items || [];
      if (!items.length) body.append(el('span', 'tc-line', t('appNone')));
      const ul = el('ul', 'tc-items');
      for (const it of items.slice(0, 12)) {
        const liItem = el('li');
        const b = el('button', 'tc-item-btn', it);
        b.type = 'button';
        b.addEventListener('click', () => openApp(it, null, b));
        liItem.append(b);
        ul.append(liItem);
      }
      if (items.length) body.append(ul);
    }
    card.append(body);
    if (r.down || r.error) card.classList.add('is-error');
    return;
  }
  if (c.tool === 'web.search' || c.tool === 'web.fetch') {
    const search = c.tool === 'web.search';
    card.classList.add('card-list', 'card-web');
    card.insertAdjacentHTML('afterbegin', svg('i-external', 'ic tc-ic'));
    body.append(el('span', 'tc-kicker', r.pending ? (search ? t('webSearching') : t('webReading')) : r.error ? t('toolFailed') : search ? t('webSearched') : t('webRead')));
    body.append(el('b', 'tc-title', search ? (r.query || c.query || '') : (r.url || c.url || '')));
    if (r.error) body.append(el('span', 'tc-line', r.error));
    else if (!r.pending && search) {
      const items = r.items || [];
      const ul = el('ul', 'tc-items');
      for (const it of items.slice(0, 8)) {
        const liItem = el('li');
        const a = el('a', 'tc-link', it.title);
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        liItem.append(a);
        ul.append(liItem);
      }
      if (items.length) body.append(ul);
    }
    if (!r.pending && !r.error) body.append(el('span', 'tc-line', search ? t('webSentSearch') : t('webSentUrl')));
    card.append(body);
    if (r.error) card.classList.add('is-error');
    return;
  }
  // Any other tool name: the model asked for something this chat does not have.
  card.classList.add('is-error');
  body.append(el('span', 'tc-kicker', t('toolFailed')), el('span', 'tc-line', r.error || c.tool || ''));
  card.append(body);
}

// ---------- Memory cards ----------
// Cards painted fresh in this visit keep their buttons; a reloaded chat shows settled cards as plain lines, except
// the ones still waiting for the user (a proposal, a forget to confirm, a choice between similar facts).
const freshCards = new WeakSet();
const WAITING = new Set(['proposal', 'forget', 'ambiguous']);
function paintMemSlot(slot, li, m, c) {
  if (!c) { slot.replaceChildren(); slot.closest('.tool-card')?.remove(); return; }
  const live = !m.memSettled && (freshCards.has(m) || WAITING.has(c.type));
  if (!live) { memory.settledCard(slot, c); return; }
  // What the user decided replaces the card that asked, in the chat's record too, so a reload shows the outcome.
  const keep = (next) => {
    if (m.result && m.call) m.result.card = next; else m.memCard = next;
    m.memSettled = true;
    if (chat && chat.messages.includes(m)) save();
  };
  memory.card(slot, c, {
    onSee: () => openMemory(),
    onDone: (x) => {
      const next = c.type === 'proposal' ? (x && x.ok !== false && x.id ? { type: 'saved', id: x.id, fact: x.fact || c.fact } : null)
        : c.type === 'forget' ? (x?.pending ? { type: 'forgotten', id: c.id } : null) : null;
      keep(next);
      paintList();
      paintMine();
    },
    // An Undo, or a card closed with «No», is kept the same way (the engine's onDone does not report these).
    onSettle: (next) => { keep(next); paintMine(); },
  });
}
// The memory cards of the open chat once the memory modules have loaded (a chat opened at start is painted before).
function repaintMemCards() {
  for (const li of ui.thread.querySelectorAll('.msg-bot')) {
    const m = li._msg;
    if (m?.call && String(m.call.tool).startsWith('memory.')) paintCard(li, m);
    if (m?.memCard) paintMemCard(li, m);
  }
}

// The card a turn left after its answer (a proposal), painted under that answer.
function paintMemCard(li, m) {
  let slot = li.querySelector(':scope > .mem-after');
  if (!m.memCard) { slot?.remove(); return; }
  if (!slot) { slot = el('div', 'mem-after'); li.append(slot); }
  paintMemSlot(slot, li, m, m.memCard);
}

// Opens an app in the panel: the saved version from Claw's storage, or, if that is not reachable, the version this
// message wrote.
async function openApp(name, m, from) {
  let html = null, saved = false;
  try { const a = await bridge.call('apps.get', { name }); html = a.html; saved = true; } catch { /* below */ }
  if (!html && m) { const call = parseToolCall(m.content || ''); if (call?.args?.html) html = String(call.args.html); }
  if (!html) return;
  panel.show({ name, html, saved }, { from });
}

// ---------- Permissions (as Claw's permissions.js: one question per scope, then remembered) ----------
// Only saving apps asks here. The memory has its own grant, kept by the memory's store (memory-wire.js).
const GRANTS = 'elffuss.grants';
const granted = new Set((() => { try { return JSON.parse(localStorage.getItem(GRANTS) || '[]'); } catch { return []; } })());

function requirePerm(scope, detail, li, signal) {
  if (granted.has(scope)) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const box = el('div', 'ask');
    box.setAttribute('role', 'group');
    const paint = () => {
      box.textContent = '';
      const h = el('h2', null, t('askApps'));
      const d = el('p', 'ask-detail', detail);
      const p = el('p', null, t('askAppsBody'));
      const yes = el('button', 'btn', t('allow')); yes.type = 'button';
      const no = el('button', 'mini-btn ask-no', t('deny')); no.type = 'button';
      yes.addEventListener('click', () => finish(true), { once: true });
      no.addEventListener('click', () => finish(false), { once: true });
      const row = el('div', 'ask-row'); row.append(yes, no);
      box.append(h, d, p, row);
      box.setAttribute('aria-label', h.textContent);
    };
    const finish = (ok) => {
      repaints.delete(paint); box.remove();
      if (ok) { granted.add(scope); try { localStorage.setItem(GRANTS, JSON.stringify([...granted])); } catch { /* — */ } }
      resolve(ok);
    };
    live(paint);
    li.append(box);
    scrollEnd(true);
    box.querySelector('.btn').focus({ preventScroll: true });
    signal.addEventListener('abort', () => { repaints.delete(paint); box.remove(); reject(Object.assign(new Error('stopped'), { name: 'AbortError' })); }, { once: true });
  });
}

// ---------- Running a tool ----------
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const ASKS_APP = /\b(app|apps|aplicaci[oó]n|aplicaciones|application|web ?app|calculadora|calculator|juego|game|formulario|form|dashboard|panel de control)\b/i;
const ASKS_NEW = /\b(new|another|second|different|separate)\b|\b(nueva|nuevo|otra|otro|distinta|distinto|segunda|aparte)\b/i;
const ASKS_EDIT = /\b(change|make (it|the)|add|remove|update|fix|edit|bigger|smaller|colou?rs?|tweak|instead|rename|move)\b|\b(cambia|ponle|pon |añade|añádele|quita|haz que|hazla|hazlo|arregla|actualiza|más grande|más pequeñ|colou?r|en vez|en lugar|mueve)\b/i;
// Answering straight away (no reasoning), the small model sometimes wraps a plain answer in a bare HTML page: a
// title, a heading, a paragraph. When no app was asked for and nothing in the page runs, styles or takes input, it
// is not an app: it is shown as the text it says.
const inertHtml = (h) => h.length < 4000 && !/<(script|style|input|button|select|textarea|canvas|svg|form|iframe|link)\b|\son\w+\s*=|style\s*=/i.test(h);
function htmlText(h) {
  const body = new DOMParser().parseFromString(h, 'text/html').body;
  const parts = [];
  for (const el of body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td')) {
    if (el.closest('li, p, pre, blockquote, td') !== el && el.closest('li, p, pre, blockquote, td')) continue;
    const s = el.textContent.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    parts.push(/^H\d$/.test(el.tagName) ? `**${s}**` : el.tagName === 'LI' ? `- ${s}` : s);
  }
  return parts.join('\n\n') || body.textContent.replace(/\s+/g, ' ').trim();
}

// What the step stores about the call: enough to paint the card again, never the whole HTML twice.
function callSummary(call) {
  const a = call.args || {};
  const s = { tool: call.tool };
  if (a.name != null) s.name = cleanName(a.name);
  if (a.fact != null) s.fact = String(a.fact).slice(0, 300);
  if (a.id != null) s.id = String(a.id).slice(0, 40);
  if (a.query != null) s.query = String(a.query).slice(0, 300);
  if (a.url != null) s.url = String(a.url).slice(0, 500);
  return s;
}

// Runs one call. Returns { text: what the model reads back (Claw's [result] message), result: what the card shows,
// end: the turn is over, say: what the visitor reads if the turn closes on this result, when it is not `text` }.
async function runTool(call, ctx) {
  const a = call.args || {};
  const es = lang === 'es';
  const down = (e) => e?.code === 'bridge-down';
  const fail = (msg) => ({ text: 'ERROR: ' + msg, result: { error: msg } });
  switch (call.tool) {
    case 'app.create': {
      let name = cleanName(a.name);
      const html = typeof a.html === 'string' ? a.html : '';
      if (!name || !html.trim()) return fail(es ? 'Falta name o html' : 'Missing name or html');
      // A model that rewrites the open app as an HTML block may change its <title>, and so its name. If an app is
      // open and the user asked for a change (and not for a new app), the new version replaces the open one.
      const open = panel.openName();
      if (call.fromHtml && open && name !== open && ASKS_EDIT.test(ctx.userText) && !ASKS_NEW.test(ctx.userText)) name = open;
      ctx.summary.name = name;
      let saved = false, replaced = false, denied = false;
      // Nothing to ask when nothing can be saved: the app runs here, unsaved, and the card says why.
      const reachable = await bridge.connect();
      const allowed = reachable && await ctx.ask('apps', name);
      if (!reachable) { /* not saved */ } else if (!allowed) denied = true;
      else {
        try {
          const r = await bridge.call('apps.save', { name, html });
          name = r.name; saved = true; replaced = r.replaced;
        } catch (e) {
          if (!down(e)) return fail((es ? 'No se pudo guardar: ' : 'Could not save: ') + (e?.message || e));
        }
      }
      ctx.summary.name = name;
      panel.show({ name, html, saved }, { from: null });
      paintMine();
      const text = saved
        ? (es ? `App «${name}» ${replaced ? 'actualizada' : 'creada'}, guardada y abierta en el panel.` : `App “${name}” ${replaced ? 'updated' : 'created'}, saved and open in the panel.`)
        : (es ? `App «${name}» abierta en el panel, SIN guardar.` : `App “${name}” open in the panel, NOT saved.`);
      return { text, result: { name, saved, replaced, denied }, end: true };
    }
    case 'app.open': {
      const name = cleanName(a.name);
      if (!name) return fail(es ? 'Falta name' : 'Missing name');
      try {
        const app = await bridge.call('apps.get', { name });
        panel.show({ name: app.name, html: app.html, saved: true }, { from: null });
        return { text: es ? `App «${name}» abierta.` : `App “${name}” opened.`, result: { name, saved: true }, end: true };
      } catch (e) {
        if (down(e)) return { text: 'ERROR: ' + t('appsDown'), result: { error: t('appsDown') }, end: true };
        return fail(es ? `No existe la app «${name}»` : `There is no app “${name}”`);
      }
    }
    case 'app.list': {
      try {
        const list = (await bridge.call('apps.list')).sort((x, y) => y.created - x.created);
        const text = list.length ? list.map((x) => `• ${x.name}`).join('\n') : (es ? 'Aún no hay ninguna app.' : 'There are no apps yet.');
        return { text, result: { items: list.map((x) => x.name) } };
      } catch { return { text: 'ERROR: ' + t('appsDown'), result: { down: true }, end: true }; }
    }
    case 'memory.save':
    case 'memory.list':
    case 'memory.forget': {
      // The engine runs the tool: the write gate (only what the user typed and asked for is saved; anything else at
      // most becomes a proposal), the forget card (nothing is deleted without the user's click), the honest answer.
      // A save that is refused (no permission) or cannot reach the memory is not the end of the turn: the model hears
      // why, plus «go on answering, do not try again», and the visitor reads only the why if the turn closes on it.
      const goOn = es ? ' Sigue respondiendo al usuario sin guardarlo y no vuelvas a intentarlo.' : ' Go on answering the user without saving it, and do not try again.';
      const andGoOn = (x) => String(x).replace(/[\s.]*$/, '.') + goOn;
      const mt = ctx.memory;
      if (!mt) {
        const off = es ? 'La memoria no está disponible ahora.' : 'Memory is not available right now.';
        return { text: call.tool === 'memory.save' ? andGoOn(off) : off, say: off, result: { card: { type: 'unavailable' } } };
      }
      const r = await mt.run(call.tool, a, { ask: ctx.askMemory });
      if (call.tool === 'memory.list') return { text: r.text, result: { list: true } };
      const notSaved = call.tool === 'memory.save' && (!r.card || r.card.type === 'unavailable');
      return { text: notSaved ? andGoOn(r.text) : r.text, ...(notSaved ? { say: r.text } : {}), result: { card: r.card || { type: 'note', text: r.text } } };
    }
    // The two tools that leave the device: the search words go to DuckDuckGo, or the address to its site, through
    // the shared Elffuss proxy. No question first (the visitor asked for it); the card shows exactly what was sent.
    case 'web.search': {
      if (mirror) return fail(t('webOff'));
      const query = String(a.query ?? a.q ?? a.text ?? '').trim().slice(0, 300);
      ctx.summary.query = query;
      try {
        const r = await web.search(query, { es, signal: ctx.signal });
        return { text: r.text, result: { query, items: r.items } };
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        return { text: 'ERROR: ' + (e?.message || e), result: { query, error: String(e?.message || e) } };
      }
    }
    case 'web.fetch': {
      if (mirror) return fail(t('webOff'));
      const url = String(a.url ?? '').trim();
      ctx.summary.url = url;
      try {
        const r = await web.fetchPage(url, { es, signal: ctx.signal });
        return { text: r.text, result: { url, title: r.title } };
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        return { text: 'ERROR: ' + (e?.message || e), result: { url, error: String(e?.message || e) } };
      }
    }
    default:
      return fail(es ? `Herramienta desconocida: ${call.tool}` : `Unknown tool: ${call.tool}`);
  }
}

// The live state for the model, read from Claw's storage on every step, as Claw's snapshot() does: the apps and the
// app open in the panel. A storage that does not answer is said as such. The memory block is asked once per turn.
async function liveContext() {
  const apps = await bridge.call('apps.list').then((l) => l.sort((x, y) => y.created - x.created), () => null);
  return { apps, open: panel.openName() };
}

// The conversation as the model reads it. Only the newest HTML of each app is sent whole; earlier versions of the
// same app are replaced by a short line, so a few rounds of changes do not fill the context with old pages.
//
// What memory.list returned is read only by the steps of the turn that asked for it (`live`, kept outside the chat's
// record): the chat stores a placeholder, so facts never sit in the chat's own database, and a fact forgotten later,
// or a chat switched to «Sin memoria», does not bring it back. Lists stored by older builds are replaced the same way.
const LIST_RESULT = '[result memory.list]';
function modelHistory(c, live = null) {
  const latest = new Map();
  c.messages.forEach((m, i) => { if (m.call?.tool === 'app.create' && m.call.name) latest.set(m.call.name, i); });
  const out = [];
  c.messages.forEach((m, i) => {
    if (!m.content || !m.content.trim()) return;
    let content = live?.get(m) ?? m.content;
    if (m.meta === 'result' && !live?.has(m) && content.startsWith(LIST_RESULT)) content = `${LIST_RESULT}\n${t('listKept')}`;
    if (m.call?.tool === 'app.create' && latest.get(m.call.name) !== i) {
      content = '```tool\n' + JSON.stringify({ tool: 'app.create', args: { name: m.call.name, html: '(an earlier version, replaced later)' } }) + '\n```';
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  });
  return out;
}

// Waits for `p` unless the turn is stopped first (Claw's hastaQueParen): a tool waiting on a permission or on the
// storage must not keep a stopped turn hanging.
function untilStopped(p, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(p).then((v) => { signal.removeEventListener('abort', stop); resolve(v); },
      (e) => { signal.removeEventListener('abort', stop); reject(e); });
  });
}

// ---------- Your apps (sidebar) ----------
let minePainting = null;
function paintMine() {
  if (minePainting) return minePainting;
  minePainting = (async () => {
    const listEl = $('mine-list'); const note = $('mine-note'); const mem = $('mem-link');
    let apps = null, facts = null;
    try { apps = (await bridge.call('apps.list')).sort((x, y) => y.created - x.created); } catch { /* down */ }
    try { facts = (await memory.load()) ? await memory.count() : null; } catch { /* down */ }
    listEl.textContent = '';
    const shown = apps ? apps.slice(0, 6) : [];
    for (const a of shown) {
      const li = el('li', 'mine-item');
      if (panel.openName() === a.name) li.setAttribute('aria-current', 'true');
      const b = el('button', 'mine-open');
      b.type = 'button';
      b.innerHTML = svg('i-window');
      b.append(el('span', null, a.name));
      b.addEventListener('click', () => { openApp(a.name, null, b); closeSide(); });
      li.append(b);
      listEl.append(li);
    }
    if (apps && apps.length > shown.length && !mirror) {
      const more = clawLink(bridge.CLAW + '/#/apps', t('mineMore', apps.length - shown.length));
      more.classList.add('mine-more');
      const li = el('li'); li.append(more); listEl.append(li);
    }
    note.textContent = apps === null ? t('mineDown') : !apps.length ? t('mineEmpty') : '';
    note.hidden = !note.textContent;
    // Shown whenever the memory answers, even empty: the panel is also where the user adds something by hand.
    mem.hidden = facts == null;
    if (facts != null) $('mem-count').textContent = t('memCount', facts);
  })().finally(() => { minePainting = null; });
  return minePainting;
}
repaints.add(() => { paintMine(); });

// ---------- The memory drawer and the «No memory» switch ----------
// The drawer holds the memory panel: the store page itself in a visible frame, so every edit, pin and forget happens
// there through the user's own clicks, and this page never handles the whole list. The frame is made when the drawer
// opens and removed when it closes.
let memOpener = null;
async function openMemory(from) {
  if (!(await memory.load())) return;
  const sheet = $('mem-sheet');
  memOpener = from || document.activeElement;
  const body = $('mem-sheet-body');
  memory.panelFrame(body, { height: narrow() ? '70dvh' : 'min(70dvh, 38rem)' });
  closeSide();
  if (!sheet.open) sheet.showModal();
}
function closeMemory() {
  const sheet = $('mem-sheet');
  if (sheet.open) sheet.close();
}
function onMemoryClosed() {
  $('mem-sheet-body').replaceChildren();
  paintMine();
  memOpener?.focus?.({ preventScroll: true });
  memOpener = null;
}

// «No memory» belongs to a chat: no memory block, no saves, no proposals in it. Before the first message it is held
// for the chat about to start.
let pendingIncognito = false;
const incognito = () => (chat ? !!chat.incognito : pendingIncognito);
// A small icon in the box, not a checkbox under it: the bookmark is memory on; crossed out, this chat neither reads
// nor saves memories. Its label says which, so a screen reader and a long press tell the same.
function paintMemToggle() {
  const btn = $('mem-btn');
  if (!btn) return;
  btn.hidden = !memory.loaded();
  if (btn.hidden) return;
  const off = incognito();
  btn.setAttribute('aria-pressed', String(off));
  btn.classList.toggle('is-off', off);
  const label = off ? t('memBtnOff') : t('memBtnOn');
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
$('mem-btn')?.addEventListener('click', () => {
  const on = !incognito();
  if (chat) { chat.incognito = on; save(); } else pendingIncognito = on;
  paintMemToggle();
});
repaints.add(paintMemToggle);

// ---------- The model card and the load progress ----------
function gate(li, signal) {
  return new Promise((resolve, reject) => {
    const m = model();
    const box = document.createElement('div');
    box.className = 'gate';
    box.setAttribute('role', 'group');
    const paint = () => {
      box.innerHTML = '';
      const h = document.createElement('h2'); h.textContent = t('gateTitle');
      const p = document.createElement('p'); p.textContent = t('gateBody', m.label);
      const size = document.createElement('p'); size.className = 'size';
      const big = document.createElement('b'); big.textContent = gb(m.bytes);
      const exact = document.createElement('span'); exact.textContent = t('bytes', num(m.bytes)) + ' · ' + m.label;
      size.append(big, exact);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn'; btn.dataset.download = '';
      btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-down"/></svg>';
      btn.append(document.createTextNode(t('gateBtn', gb(m.bytes))));
      btn.addEventListener('click', () => { repaints.delete(paint); box.remove(); resolve(); }, { once: true });
      box.append(h, p, size, btn);
      box.setAttribute('aria-label', t('gateTitle'));
    };
    live(paint);
    li.append(box);
    scrollEnd(true);
    box.querySelector('button').focus({ preventScroll: true });
    signal.addEventListener('abort', () => { repaints.delete(paint); box.remove(); reject(Object.assign(new Error('stopped'), { name: 'AbortError' })); }, { once: true });
  });
}

// While the model comes in, the box explains what is happening. Two steps, in this order: download, then load onto
// the graphics card. The mosaic is the model: a cell turns grey when its share of the bytes has arrived and ink when
// it is on the graphics card, driven by the real progress, never by a timer. Under it, five lines say what this is.
const CELLS = 144;
const SLIDE_MS = 6500;
const DOWN_KEYS = new Set(['downloading', 'downloadingPct']);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function progressBox(li) {
  const m = model();
  const cached = modelState === 'cached';
  const box = document.createElement('div');
  box.className = 'loadbox';
  box.innerHTML = '<ol class="lb-steps"><li data-step="down"><span class="lb-n">1</span><span class="lb-l"></span></li>'
    + '<li data-step="load"><span class="lb-n">2</span><span class="lb-l"></span></li></ol>'
    + '<div class="lb-mosaic is-busy" aria-hidden="true"></div><div class="lb-story"></div><div class="lb-dots" aria-hidden="true"></div>'
    + '<div class="meter is-busy" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div><p class="progress-text" aria-live="polite"></p>';
  li.append(box);
  const $$ = (s) => box.querySelector(s);
  const meter = $$('.meter'); const bar = meter.querySelector('i'); const text = $$('.progress-text');
  const mosaic = $$('.lb-mosaic'); const story = $$('.lb-story'); const dots = $$('.lb-dots');
  const stepDown = $$('[data-step="down"]'); const stepLoad = $$('[data-step="load"]');

  // The cells fill in a scattered but fixed order, the way tensors land all over the file rather than front to back.
  // Each knows its place on the diagonal of the 24-column grid, for the waves.
  const rank = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = CELLS - 1, s = 7; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [rank[i], rank[j]] = [rank[j], rank[i]]; }
  const cells = rank.map((r, i) => {
    const c = document.createElement('i');
    c.style.setProperty('--d', (i % 24) + Math.floor(i / 24));
    mosaic.append(c);
    return { el: c, rank: r, s: '' };
  });

  let phase = cached ? 'load' : 'down';     // down | load | done
  let down = cached ? 100 : 0, up = 0;      // per cent of the bytes here, and on the graphics card
  let last = { key: cached ? 'fromDisk' : 'starting', args: [], pct: null };
  let slide = 0;
  let net = false;                          // read from the network because the browser could not save it
  // Why it could not be saved: the store says so in the engine's console warning, and nowhere else.
  let why = '';
  const warn = console.warn;
  console.warn = (...a) => { const w = a.map(String).join(' '); if (/almacén|store|quota|cuota|No cabe/i.test(w)) why = w; warn.apply(console, a); };

  const paint = () => {
    text.textContent = t(last.key, ...last.args);
    meter.setAttribute('aria-label', text.textContent);
    if (last.pct == null) { meter.classList.add('is-busy'); meter.removeAttribute('aria-valuenow'); }
    else { meter.classList.remove('is-busy'); bar.style.width = last.pct + '%'; meter.setAttribute('aria-valuenow', String(last.pct)); }
    stepDown.dataset.state = net ? 'warn' : phase === 'down' ? 'on' : 'done';
    stepDown.querySelector('.lb-l').textContent = t(net ? 'lbNotSaved' : cached ? 'lbHere' : 'lbDownload');
    stepLoad.dataset.state = phase === 'down' ? '' : phase === 'load' ? 'on' : 'done';
    mosaic.classList.toggle('is-busy', phase === 'down' && down === 0);
    mosaic.classList.toggle('is-ready', phase === 'done');
    const nd = Math.round(down / 100 * CELLS), nu = Math.round(up / 100 * CELLS);
    for (const c of cells) {
      const s = c.rank < nu ? 'g' : c.rank < nd ? 'd' : '';
      if (s !== c.s) { c.s = s; c.el.dataset.s = s; }
    }
  };
  const showSlide = () => {
    story.querySelectorAll('.lb-slide').forEach((el, i) => el.classList.toggle('is-on', i === slide));
    dots.querySelectorAll('i').forEach((el, i) => el.classList.toggle('is-on', i === slide));
  };
  const words = () => {
    stepLoad.querySelector('.lb-l').textContent = t('lbLoad');
    const lines = t('story', m?.label || '', gb(m?.bytes || 0), cached);
    story.innerHTML = ''; dots.innerHTML = '';
    for (const [head, body] of lines) {
      const s = document.createElement('div'); s.className = 'lb-slide';
      const h = document.createElement('p'); h.className = 'lb-head'; h.textContent = head;
      const p = document.createElement('p'); p.className = 'lb-body'; p.textContent = body;
      s.append(h, p); story.append(s);
      dots.append(document.createElement('i'));
    }
    showSlide();
    paint();
  };
  live(words);
  // Two frames, so the first line arrives with its wipe instead of already in place.
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('is-live')));
  // The second line talks about the download: once every byte is here it is no longer true, so it drops out.
  const timer = setInterval(() => {
    if (document.hidden) return;
    const n = story.children.length;
    slide = (slide + 1) % n;
    if (slide === 1 && !cached && phase !== 'down') slide = 2 % n;
    showSlide();
  }, SLIDE_MS);

  return {
    set(key, args = [], pct = null) {
      // When the browser could not save the model, the engine reads it from the network piece by piece and puts each
      // piece on the graphics card as it arrives. The percentage it reports is what is on the card, so that is what
      // the box says: loading, and that this copy is not being saved.
      if (key === 'netGpu') {
        net = true; phase = 'load'; key = 'gpuNet';
        if (pct != null) { up = Math.max(up, pct); down = Math.max(down, up); }
      }
      if (DOWN_KEYS.has(key) && pct != null) down = Math.max(down, pct);
      if (key === 'gpu' || key === 'cpu') { phase = 'load'; down = 100; if (pct != null) up = Math.max(up, pct); }
      if (key === 'ready') { phase = 'done'; down = up = 100; }
      last = { key, args, pct };
      paint();
    },
    get net() { return net; },
    get why() { return why; },
    done() {
      repaints.delete(words); clearInterval(timer); console.warn = warn;
      if (reduceMotion()) { box.remove(); return; }
      box.classList.add('is-leaving');
      setTimeout(() => box.remove(), 280);
    },
  };
}

// The engine reports its progress as short Spanish strings (its own log), and the shared store as {loaded, total}.
// They are translated into this page's words here; the engine's text is never shown.
function onEngineProgress(p) {
  const s = progressSink;
  if (!s) return;
  if (p && typeof p === 'object') {
    if (p.total) {
      const pct = Math.min(100, Math.floor((p.loaded / p.total) * 100));
      s.set('downloading', [mb(p.loaded), mb(p.total), pct], pct);
    }
    return;
  }
  const str = String(p || '');
  const pct = (str.match(/(\d+)\s*%/) || [])[1];
  const n = pct == null ? null : Math.min(100, +pct);
  let mm;
  if (/subiéndolo/i.test(str)) s.set('netGpu', [n ?? 0], n);
  else if (/Subiendo/i.test(str)) s.set('gpu', [n ?? 0], n);
  else if ((mm = str.match(/(\d+)\/(\d+) MB/))) s.set('downloading', [mb(+mm[1] * 1048576), mb(+mm[2] * 1048576), n ?? 0], n);
  else if (/Descargando el modelo/i.test(str)) s.set('downloadingPct', [n ?? 0], n);
  else if (/disco|Recuperando/i.test(str)) s.set('fromDisk', [], null);
  else if (/índice/i.test(str)) s.set('index', [], null);
  else if (/en la CPU/i.test(str)) s.set('cpu', [n ?? 0], n);
  else if (/GPU/i.test(str)) s.set('starting', [], null);
  else if (/listo/i.test(str)) s.set('ready', [], 100);
}

// Said once, before the answer, when the model was read from the network instead of saved: otherwise the next visit
// downloads it again and nothing on the page says why.
async function notSavedNote(li, why) {
  let free = null;
  try { const e = await navigator.storage.estimate(); if (e.quota) free = Math.max(0, e.quota - (e.usage || 0)); } catch { /* unknown */ }
  const m = model();
  const space = /quota|cuota|No cabe|espacio|sitio/i.test(why) || (free != null && m && free < m.bytes * 1.1);
  // Its own item in the thread, before the answer: the answer's message is repainted whole while it is written.
  const item = document.createElement('li');
  item.className = 'msg msg-note';
  const p = document.createElement('p');
  p.className = 'note note-warn';
  item.append(p);
  live(() => { p.textContent = space ? t('notSavedSpace', free != null ? gb(free) : '') : t('notSaved'); });
  li.before(item);
}

// A tab that stays hidden without answering lets the model go: on the processor it holds more than a gigabyte of
// memory and a pool of threads, on the graphics card the same in video memory, and the visitor is doing something
// else. The next message loads it again from this browser's store, with nothing to download. A turn that is running
// when the tab hides is left to finish; nothing is kept awake on purpose.
const RELEASE_HIDDEN_MS = { cpu: 3 * 60_000, gpu: 10 * 60_000 };
let releaseTimer = null;
let releasing = null;               // the unload in flight; a load waits for it
function watchHidden() {
  clearTimeout(releaseTimer);
  releaseTimer = null;
  if (!document.hidden || !loading) return;
  releaseTimer = setTimeout(async () => {
    const idle = () => document.hidden && !turn && loading;
    if (!idle()) return;
    try { await loading; } catch { return; }
    if (!idle()) return;
    loading = null;
    releasing = engine.unload().catch(() => {}).finally(() => { releasing = null; });
    await releasing;
    console.info('[chat] model released: the tab was hidden and idle');
    setModelState((await isCached()) ? 'cached' : 'missing');
  }, device.cpu ? RELEASE_HIDDEN_MS.cpu : RELEASE_HIDDEN_MS.gpu);
}
document.addEventListener('visibilitychange', watchHidden);

function loadEngine() {
  if (!loading) {
    setModelState('loading');
    loading = (async () => {
      if (releasing) await releasing;
      engine = engine || await import('./js/engine/provider.js');
      if (device.cpu) globalThis.__ELFFUSS_CPU = true;
      engine.configure(device.id);
      await engine.load(onEngineProgress);
    })().then(() => setModelState('ready'), (e) => { loading = null; isCached().then((c) => setModelState(c ? 'cached' : 'missing')); throw e; });
  }
  return loading;
}

function friendly(e) {
  const s = String(e?.message || e);
  if (/otra pestaña/i.test(s)) return 'errTab';
  if (/espacio|Failed to fetch|NetworkError|quota|cuota|No cabe|se cortó/i.test(s)) return 'errSpace';
  if (/perdido la GPU|no está cargado/i.test(s)) return 'errLost';
  if (/binding|buffers lo bastante/i.test(s)) return 'errBinding';
  if (/WebGPU|adaptador/i.test(s)) return 'errGpu';
  if (/memoria|out-of-memory/i.test(s)) return 'errMemory';
  return 'errGeneric';
}

function showError(li, e, retry) {
  const box = document.createElement('div');
  box.className = 'err';
  const key = friendly(e);
  const paint = () => {
    box.innerHTML = '';
    const b = document.createElement('b'); b.textContent = t(key);
    const d = document.createElement('details');
    const sm = document.createElement('summary'); sm.textContent = t('details');
    const pre = document.createElement('div'); pre.textContent = String(e?.message || e);
    d.append(sm, pre);
    box.append(b, d);
    if (retry) {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'mini-btn'; r.textContent = t('retry');
      r.addEventListener('click', () => { repaints.delete(paint); box.remove(); retry(); }, { once: true });
      box.append(document.createElement('br'), r);
    }
  };
  live(paint);
  li.append(box);
  scrollEnd(true);
}

// ---------- A turn ----------
function setBusy(on, generating = false) {
  ui.send.hidden = generating;
  ui.stop.hidden = !generating;
  ui.send.disabled = on || !ui.input.value.trim();
  if (generating) ui.stop.focus({ preventScroll: true });
}

// Stops the running turn: the engine's own stop, through its signal. Resolves once the turn has let go.
async function stopTurn() {
  if (!turn) return;
  const done = turn.done;
  turn.ctl.abort();
  try { await done; } catch { /* the turn reports its own end */ }
}

const split = (raw) => {
  const i = raw.lastIndexOf('</think>');
  const clean = (s) => s.replace(/<\/?think>/g, '');
  return i < 0 ? { thinking: clean(raw), content: '' } : { thinking: clean(raw.slice(0, i)), content: clean(raw.slice(i + 8)).replace(/^\s+/, '') };
};

// `typed`: the user wrote this in the box (not pasted or dropped, not a button's text, not over the typed limit). Only
// typed messages can ground a memory: the store refuses a save whose fact is not in what the user typed.
const TYPED_MAX = 1500;
async function send(text, { typed = false } = {}) {
  await detected;
  if (turn || !device.ok) return;
  if (!chat) {
    chat = { id: newId(), title: titleOf(text), created: Date.now(), updated: Date.now(), messages: [] };
    if (pendingIncognito) chat.incognito = true;
    pendingIncognito = false;
    try { localStorage.setItem(CURRENT, chat.id); } catch { /* — */ }
  }
  chat.messages.push({ role: 'user', content: text, ...(typed && text.length <= TYPED_MAX ? { typed: true } : {}) });
  await save();
  ui.main.classList.remove('is-empty');
  appendUser(text);
  paintList();
  const li = appendBot();
  scrollEnd(true);
  await answer(li);
}

// `reason: false` answers without the reasoning step, for when reasoning used the whole budget (see 'cut'). By
// default the turn reasons or not as the engine's registry says for the model, the same as in Claw and Code.
function answer(li, { reason = null } = {}) {
  const mine = chat;
  const ctl = new AbortController();
  turn = { ctl, chatId: mine.id };
  turn.done = runTurn(li, mine, ctl, reason);
  return turn.done;
}

function retryWithoutReasoning(li, mine, msg) {
  if (turn || chat !== mine) return;
  const i = mine.messages.indexOf(msg);
  if (i >= 0) mine.messages.splice(i, 1);
  li.textContent = '';
  answer(li, { reason: false });
}

// One turn is Claw's agent loop (web/js/agent.js): the model writes; if what it wrote is a tool call, the tool runs,
// its result goes back to the model as a "[result …]" message, and the model writes again, up to MAX_STEPS. Making
// or opening an app ends the turn, as in Claw: the card and the panel are the answer. Each step is its own message
// in the thread, with its own reasoning.
const MAX_STEPS = 5;

async function runTurn(li, mine, ctl, reason) {
  setBusy(true);
  let msg = { role: 'assistant', content: '', thinking: '' };
  let stage = 'wait';
  let raw = '';
  let finished = false;
  let stepPushed = false;           // the current step's message is already in the chat (a tool step)
  const userText = [...mine.messages].reverse().find((m) => m.role === 'user' && m.meta !== 'result')?.content || '';
  // Asked for an app: no reasoning step. The small model plans the whole page in its reasoning, spends the budget
  // (4,000 tokens, minutes on a phone) and has nothing left to write it with; straight away it writes the page.
  if (reason !== false && ASKS_APP.test(userText)) reason = false;
  // On the processor it answers straight away: a thousand tokens of reasoning are minutes before the first letter
  // there, and the engine keeps a shorter context on the processor, where the reasoning budget does not fit.
  if (device.cpu) reason = false;
  let mt = null;                    // this turn's memory (memory-wire.js beginTurn), or null without memory
  let failed = false;
  try {
    await checked;
    if (modelState !== 'ready') {
      if (modelState === 'missing') { stage = 'gate'; await gate(li, ctl.signal); }
      if (ctl.signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      stage = 'load';
      const box = progressBox(li);
      progressSink = box;
      try { await loadEngine(); } finally { progressSink = null; box.done(); }
      if (box.net) notSavedNote(li, box.why);
      if (ctl.signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    }
    stage = 'gen';
    setBusy(true, true);
    engine.setSampling?.({ razonar: reason === false ? false : null });
    // The memory for this turn: asked once, from the store, with the model's registry entry (its id and context size
    // set the budget). The same bytes go into every step; only a save during the turn rebuilds it.
    let memPrompt = null;
    const done = [];                 // signatures of the calls already run this turn (Claw's anti-loop)
    const liveResults = new Map();   // result message -> what the model reads in this turn only (memory.list)
    let lastText = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      if (step > 0) {
        li = appendBot();
        msg = { role: 'assistant', content: '', thinking: '' };
        raw = ''; stepPushed = false; finished = false;
      }
      paintBot(li, msg, { thinkingLive: true });
      scrollEnd();
      if (step === 0) {
        mt = await untilStopped(memoryTurn(mine), ctl.signal);
        if (mt?.block.unavailable) noteMemoryDown(li, mine);
        memPrompt = memory.promptPieces(lang);
      }
      const now = await untilStopped(liveContext(), ctl.signal);
      const history = withContext(modelHistory(mine, liveResults), contextBlock(lang, { ...now, memory: mt?.block.text || '', today: memory.today(lang) }), CONTEXT_LABEL[lang]);
      let queued = false;
      const paint = () => {
        queued = false;
        if (finished) return;              // a frame that arrives after the step ended must not repaint it as live
        const p = reason === false ? { thinking: '', content: raw } : split(raw);
        msg.thinking = p.thinking; msg.content = p.content;
        paintBot(li, msg, { writing: true, thinkingLive: !p.content });
        scrollEnd();
      };
      // The memory block travels inside `history` (the CONTEXT NOW message), so the engine already counts it when it
      // fits the history to the model's context: no `reserveTokens` on top, or it would be subtracted twice.
      const result = await engine.chat(history, systemPrompt(lang, memPrompt, { web: !mirror }), (tok) => {
        raw += tok;
        if (!queued) { queued = true; requestAnimationFrame(paint); }
      }, { signal: ctl.signal, onPrefill: (done, total) => { if (!finished && !raw) paintReading(li, done, total); } });
      finished = true;
      const p = reason === false ? { thinking: '', content: raw } : split(raw);
      msg.thinking = raw.includes('</think>') ? p.thinking : (result ? '' : p.thinking);
      msg.content = String(result || '').trim();
      const call = msg.content ? parseToolCall(msg.content) : null;
      if (call?.fromHtml && !ASKS_APP.test(userText) && inertHtml(String(call.args?.html || ''))) {
        // What it wrote before the page, if anything, is the answer; if not, the page's own text.
        const before = msg.content.split(/```html|<!doctype html|<html[\s>]/i)[0].trim();
        msg.content = before || htmlText(String(call.args.html));
        break;
      }
      if (!call) {
        // A call the model did not finish (the budget ran out inside it) is not run and not shown as markup.
        const wt = writingTool(msg.content);
        if (wt) { msg.content = wt.before; msg.note = 'cutTool'; }
        else if (!msg.content) msg.note = 'cut';
        break;
      }
      const sig = call.tool + ':' + JSON.stringify(call.args || {});
      if (done.includes(sig)) {          // the same call again: close with what the last one said
        msg.content = lastText && !lastText.startsWith('ERROR') ? lastText : t('anythingElse');
        break;
      }
      done.push(sig);

      msg.call = callSummary(call);
      msg.result = null;
      paintBot(li, msg);
      if (call.tool.startsWith('memory.')) freshCards.add(msg);
      const ctx = {
        userText, summary: msg.call, memory: mt, signal: ctl.signal,
        ask: (scope, detail) => untilStopped(requirePerm(scope, detail, li, ctl.signal), ctl.signal),
        askMemory: (c) => untilStopped(askMemory(li, c, ctl.signal), ctl.signal),
      };
      const res = await untilStopped(runTool(call, ctx), ctl.signal);
      // Any tool that is not memory taints the turn: what it returned is not the user's word, so a save after it can
      // only become a proposal.
      mt?.tool(call.tool);
      msg.result = res.result;
      const listed = call.tool === 'memory.list';
      lastText = listed ? t('anythingElse') : (res.say ?? res.text);    // what the visitor may read if the turn closes on it
      paintBot(li, msg);
      scrollEnd();
      mine.messages.push(msg);
      stepPushed = true;
      const hint = res.text.startsWith('ERROR') && !res.end ? (lang === 'es' ? '\n(Reanaliza este error y reintenta con la corrección.)' : '\n(Look at this error again and retry with the fix.)') : '';
      const resultMsg = { role: 'user', content: `[result ${call.tool}]\n${listed ? t('listKept') : res.text}${hint}`, meta: 'result' };
      if (listed) liveResults.set(resultMsg, `[result ${call.tool}]\n${res.text}${hint}`);
      mine.messages.push(resultMsg);
      mine.updated = Date.now();
      await store.put(mine);
      if (res.end) { msg = null; break; }
      if (step === MAX_STEPS - 1) {
        li = appendBot();
        msg = { role: 'assistant', content: lastText && !lastText.startsWith('ERROR') ? lastText : t('anythingElse'), thinking: '' };
        stepPushed = false;
      }
    }
  } catch (e) {
    if (ctl.signal.aborted || e?.name === 'AbortError') {
      if (msg && !stepPushed) {
        // Keep what was written before the stop, exactly as it was on screen.
        const p = reason === false ? { thinking: '', content: raw } : split(raw);
        msg.thinking = p.thinking; msg.content = p.content.trim();
        if (msg.call) msg.result = msg.result || { error: t('stopped') };
        msg.stopped = true;
        if (stage === 'gate') msg.note = 'noAnswer';
      }
    } else {
      failed = true;
      showError(li, e, () => { if (!turn && chat === mine) answer(li); });
      if (friendly(e) === 'errLost') { loading = null; setModelState('cached'); }
    }
  } finally {
    finished = true;
    turn = null;
    setBusy(false);
    // A turn that ended while the tab was hidden: the count to let the model go starts now.
    if (document.hidden) watchHidden();
    if (msg && !stepPushed) {
      // A step stopped while it was writing a tool call keeps its words, not the half-written call.
      if (msg.stopped && !msg.call && writingTool(msg.content)) msg.content = writingTool(msg.content).before;
      paintBot(li, msg);
      if (msg.content || msg.thinking || msg.stopped) {
        if (!li.querySelector('.err')) {
          mine.messages.push(msg);
          mine.updated = Date.now();
          await store.put(mine);
        }
      }
      // Reasoning used the whole budget and left no answer: answer again at once without the reasoning step, once,
      // instead of waiting for the visitor to find the button. Seen with app requests, where the small model plans the
      // whole page in its reasoning and runs out before writing it.
      if (msg.note === 'cut' && chat === mine && reason !== false && !msg.stopped) {
        setTimeout(() => retryWithoutReasoning(li, mine, msg), 0);
      } else if (msg.note === 'cut' && chat === mine) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mini-btn'; b.dataset.noReason = '';
        const label = () => { b.textContent = t('noReason'); };
        live(label);
        const m = msg;
        b.addEventListener('click', () => { repaints.delete(label); retryWithoutReasoning(li, mine, m); }, { once: true });
        li.append(b);
      }
    }
    if (chat === mine) ui.input.focus({ preventScroll: true });
  }
  // After the final answer of a typed turn: the facts that were in context, and at most one proposal from what the user
  // wrote («I live in Valencia» → «Remember this?»). The turn is already over: the user can type meanwhile.
  if (mt && msg && !failed && !msg.stopped && !msg.call && msg.content && chat === mine) await afterTurn(li, msg, mt, mine).catch(() => {});
}

async function memoryTurn(mine) {
  if (!(await memory.load())) return null;
  if (!mine.memConv) { mine.memConv = memory.newConv(); await store.put(mine); }
  const entry = MODELS[device.id];
  return memory.beginTurn({
    messages: mine.messages, conv: mine.memConv, incognito: !!mine.incognito,
    // On the processor the engine keeps a shorter context than the registry's (its cache is f32, in the same tab as
    // the weights): the memory must pack for that one.
    model: { id: device.id, ctx: (device.cpu && engine?.contextoEfectivo?.()) || (Number.isFinite(entry?.ctx) ? entry.ctx : null) },
  });
}

async function afterTurn(li, msg, mt, mine) {
  const state = memory.proposalState(mine, await store.get(mine.id).catch(() => null));
  const f = await mt.finish({ state });
  if (state.proposed > (mine.memProposed | 0)) {
    memory.keepProposalState(mine, state);
    if (await store.get(mine.id).catch(() => null)) await store.put(mine);
  }
  if (f.used) {
    const slot = el('div', 'mem-used');
    li.append(slot);
    memory.used(slot, f.used);
  }
  if (!f.proposal) return;
  // A «Yes» needs the chat's grant: the grant card comes first, and the proposal only if the user allows it.
  if (await memory.needsGrant()) {
    const ok = await askMemory(li, { type: 'grant' }, new AbortController().signal).catch(() => false);
    if (!ok) return;
  }
  msg.memCard = f.proposal;
  freshCards.add(msg);
  paintMemCard(li, msg);
  if (mine.messages.includes(msg)) await store.put(mine);
}

// The memory's grant card, in the step that wants to save: resolves with the user's answer.
function askMemory(li, c, signal) {
  return new Promise((resolve, reject) => {
    const slot = el('div', 'mem-ask');
    li.append(slot);
    scrollEnd(true);
    const end = (ok) => { slot.remove(); memory.noteGrant(ok); resolve(ok); };
    memory.card(slot, c, { onGranted: end });
    slot.querySelector('button')?.focus({ preventScroll: true });
    signal.addEventListener('abort', () => { slot.remove(); reject(Object.assign(new Error('stopped'), { name: 'AbortError' })); }, { once: true });
  });
}

// «Memory unavailable right now · Retry», once per chat and visit: the turn goes on without memory.
const memDownShown = new Set();
function noteMemoryDown(li, mine) {
  if (memDownShown.has(mine.id)) return;
  memDownShown.add(mine.id);
  const slot = el('div', 'mem-after');
  li.append(slot);
  memory.card(slot, { type: 'unavailable' });
}


// ---------- Sidebar drawer and apps sheet ----------
// On a computer the menu can be hidden (remembered in this browser); on a phone it is the drawer below.
const SIDE_KEY = 'elffuss.side.hidden';
let sideHidden = (() => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } })();
const wide = () => matchMedia('(min-width: 900px)').matches;
function keepSide() { try { localStorage.setItem(SIDE_KEY, sideHidden ? '1' : '0'); } catch { /* private mode */ } }
function setSide(hidden) { $('app')?.classList.toggle('side-collapsed', !!hidden); }
setSide(sideHidden);
let opener = null;
function openSide(btn) {
  opener = btn;
  ui.side.classList.add('is-open');
  ui.scrim.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  ui.side.querySelector('.new-chat, .chat-open, a')?.focus();
}
function closeSide() {
  if (!ui.side.classList.contains('is-open')) return;
  ui.side.classList.remove('is-open');
  ui.scrim.hidden = true;
  document.querySelector('[data-open-side]')?.setAttribute('aria-expanded', 'false');
  opener?.focus();
}

// The install entry in the menu opens its box under the top bar: the drawer gets out of the way.
$('install-entry')?.addEventListener('click', () => closeSide());

function appListClone() {
  const frag = document.createDocumentFragment();
  const nav = $('apps-nav');
  frag.append(nav.querySelector('.app-list').cloneNode(true), nav.querySelector('.all-apps').cloneNode(true));
  return frag;
}

// ---------- Language ----------
function applyLang(value) {
  lang = value;
  root.lang = value;
  memory.setLang(value);
  document.title = t('title');
  for (const b of document.querySelectorAll('[data-set-lang]')) b.setAttribute('aria-pressed', String(b.dataset.setLang === value));
  for (const el of document.querySelectorAll(`[data-aria-${value}]`)) el.setAttribute('aria-label', el.getAttribute(`data-aria-${value}`));
  for (const el of document.querySelectorAll(`[data-ph-${value}]`)) el.setAttribute('placeholder', el.getAttribute(`data-ph-${value}`));
  for (const el of document.querySelectorAll(`[data-title-${value}]`)) el.setAttribute('title', el.getAttribute(`data-title-${value}`));
  for (const fn of repaints) fn();
  for (const li of ui.thread.querySelectorAll('.msg-bot')) {
    const s = li.querySelector('.stamp'); if (s) s.textContent = t('stopped');
    const sm = li.querySelector('.think:not(.is-live) summary'); if (sm) sm.textContent = t('reasoning');
    if (li._msg?.call && li.querySelector('.tool-card')) paintCard(li, li._msg);
    if (li._msg?.memCard) paintMemCard(li, li._msg);
  }
  if ($('mem-sheet')?.open) memory.panelFrame($('mem-sheet-body'), { height: narrow() ? '70dvh' : 'min(70dvh, 38rem)' });
  panel.repaint();
}

// ---------- Wiring ----------
function autosize() {
  ui.input.style.height = 'auto';
  ui.input.style.height = Math.min(ui.input.scrollHeight, innerHeight * 0.4) + 'px';
  ui.send.disabled = !!turn || !ui.input.value.trim();
}

// Text that arrives in the box by pasting or dropping is not typed: the message it ends up in cannot ground a memory.
let pasted = false;
function wire() {
  ui.input.addEventListener('input', () => { if (!ui.input.value) pasted = false; autosize(); });
  ui.input.addEventListener('paste', () => { pasted = true; });
  ui.input.addEventListener('drop', () => { pasted = true; });
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ui.form.requestSubmit(); }
  });
  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ui.input.value.trim();
    if (!text || turn) return;
    const typed = !pasted;
    ui.input.value = '';
    pasted = false;
    autosize();
    send(text, { typed });
  });
  ui.stop.addEventListener('click', stopTurn);
  for (const b of document.querySelectorAll('[data-new-chat]')) b.addEventListener('click', () => { startNew(); closeSide(); });
  document.querySelector('[data-open-side]')?.addEventListener('click', (e) => {
    if (wide() && $('app').classList.contains('side-collapsed')) { sideHidden = false; keepSide(); setSide(false); return; }
    openSide(e.currentTarget);
  });
  document.querySelector('[data-collapse-side]')?.addEventListener('click', () => {
    sideHidden = true; keepSide(); setSide(true);
    document.querySelector('[data-open-side]')?.focus({ preventScroll: true });
  });
  for (const b of document.querySelectorAll('[data-close-side]')) b.addEventListener('click', closeSide);
  ui.scrim.addEventListener('click', closeSide);
  document.querySelector('[data-open-apps]')?.addEventListener('click', () => {
    const body = $('sheet-body');
    if (!body.firstChild) body.append(appListClone());
    ui.sheet.showModal();
  });
  document.querySelector('[data-close-apps]')?.addEventListener('click', () => ui.sheet.close());
  $('mem-link')?.addEventListener('click', (e) => openMemory(e.currentTarget));
  document.querySelector('[data-close-mem]')?.addEventListener('click', closeMemory);
  $('mem-sheet')?.addEventListener('close', onMemoryClosed);
  $('mem-sheet')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeMemory(); });
  ui.sheet.addEventListener('click', (e) => { if (e.target === ui.sheet) ui.sheet.close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSide(); });
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest?.('[data-set-lang]');
    if (!toggle) return;
    const value = toggle.dataset.setLang === 'es' ? 'es' : 'en';
    applyLang(value);
    try { localStorage.setItem('elffuss-lang', value); } catch { /* — */ }
    try {
      const url = new URL(location.href);
      if (url.searchParams.has('lang')) { url.searchParams.set('lang', value); history.replaceState(null, '', url); }
    } catch { /* — */ }
  });
}

async function boot() {
  // The panel first: the language pass repaints it.
  panel.init({ t, onFix: (name, error) => {
    if (turn || !device.ok) return;
    if (narrow()) panel.close();
    send(t('fixAsk', name, error));          // the app's error text, not the user's words: not typed
  }, onChange: () => {
    for (const li of document.querySelectorAll('.mine-item')) {
      if (li.textContent === panel.openName()) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    }
  } });
  applyLang(lang);
  mountNote($('main'));
  wire();
  // The app open inside the page is marked in the sidebar, like the open chat.
  appview.start({ onChange: (key) => {
    if (wide()) setSide(key ? true : sideHidden);
    for (const l of document.querySelectorAll('.app-link')) {
      let host = ''; try { host = new URL(l.href).host; } catch { /* — */ }
      if (key && host.startsWith(key + '.')) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current');
    }
  } });
  autosize();
  // The shared memory: its modules are this site's own files; the store answers through a hidden frame.
  memory.onChange(() => { paintMine(); });
  // A save queued while the store was down, and the chat has no grant yet: the grant card, under the latest answer.
  memory.watchQueued((c) => {
    const li = [...ui.thread.querySelectorAll('.msg-bot')].pop();
    return li ? askMemory(li, c, new AbortController().signal) : undefined;
  });
  memory.load().then((m) => { if (m) { paintMemToggle(); paintMine(); repaintMemCards(); } });
  // Claw may have changed the apps or the memory in another tab: look again when this one comes back.
  addEventListener('focus', () => paintMine());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paintMine(); });
  let last = null;
  try { last = localStorage.getItem(CURRENT); } catch { /* — */ }
  if (last) await openChat(last); else paintList();

  Object.assign(device, await pickDevice());
  markDetected();
  if (!device.ok) { showNoGpu(device.why); return; }
  setModelState('checking');
  setModelState((await isCached()) ? 'cached' : 'missing');
  markChecked();
}

boot().catch((e) => console.error('[chat] boot failed', e));
