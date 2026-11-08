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
//
// It also makes pictures, music, speech and video with the elffuss-ai SDK (media-tools.js, the SDK copied by pin into
// /vendor/elffuss-ai/): the chat model leaves the graphics card to the task while it runs and comes back after. What
// the user attaches (documents, photos, videos) is read here (attach.js) and never leaves the device.

import * as store from './store.js';
import { render } from './md.js';
import { MODELS, cachea } from './js/engine/registro.js';
import * as bridge from './bridge.js';
import * as panel from './panel.js';
import * as memory from './memory-wire.js';
import { offerInstall, installGate } from './install.js';
import * as web from './web.js';
import * as appview from './appview.js';
import { mirror, WORDS as MIRROR_WORDS, mountNote } from './mirror.js';
import { parseToolCall, writingTool, systemPrompt, contextBlock, withTurnContext, CONTEXT_LABEL } from './tools.js';
import { createMediaTools, isMediaTool, mediaKindOf, mediaUrl, getMedia, downloadName, removeChatMedia, setMediaChat, formatBytes, describedLine } from './media-tools.js';
import { needsMediaTools, hasMediaIn, editTarget } from './media-intent.js';
import { needsAppTools, wrapsOnlyMedia } from './app-intent.js';
import { attachFile, docContext, mediaContext, kindOf, DOC_ACCEPT, canRecord, recorderPanel, peaksCanvas, startRecording, toMono16k, keepVoiceNote } from './attach.js';
import { createVoice } from './voice.js';
import { inputHistory } from './input-history.js';

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
    bootFailed: (why) => `The chat could not finish starting (${why}). Reload the page to try again.`,
    stMissing: (size) => `${size} to download, once`,
    stReady: 'Ready on this device',
    stLoading: 'Loading…',
    fineCached: (label) => `${label} is already in this browser: 0 bytes to download. It runs on this device, and chats are kept in this browser only.`,
    fineReady: (label) => `${label} is loaded and runs on this device. Chats are kept in this browser only.`,
    fineMissing: (label, size) => `The first answer needs a one-time download of ${label}, ${size}. It runs on this device, and chats are kept in this browser only.`,
    fineCpu: 'This browser has no usable WebGPU, so the model runs on the processor: slower than on a graphics card.',
    thinking: 'Thinking…',
    reading: (n) => `Reading · ${n}%`,
    speed: (r, rs, w, ws) => `Read ${r} tokens at ${rs} tok/s · wrote ${w} at ${ws} tok/s`,
    speedCached: (c) => ` (${c} already in memory)`,
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
    makeApp: 'Create as an app',
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
    webSentRead: (n) => `Only these search words left this device, to DuckDuckGo, and the ${n === 1 ? 'address of the page' : n + ' addresses of the pages'} it read to answer.`,
    webSentSite: (n) => `Only the search words and ${n === 1 ? 'this address' : 'these ' + n + ' addresses'} left this device, to read that site (its robots.txt included).`,
    webSentList: 'What left this device',
    webSent: ({ engine, ddg, pages, site }) => {
      const to = engine && ddg ? 'to the Elffuss search server, which asks several search engines, and, as a fallback, to DuckDuckGo'
        : engine ? 'to the Elffuss search server, which asks several search engines' : ddg ? 'to DuckDuckGo' : '';
      const words = to ? `the search words, ${to}` : (site ? 'the search words' : '');
      const addr = pages ? `${pages === 1 ? 'one address' : pages + ' addresses'} to read ${site ? 'that site (its robots.txt included)' : 'the pages that answer'}` : '';
      return `Only this left this device: ${[words, addr].filter(Boolean).join('; and ')}.`;
    },
    webSiteSearching: 'Searching the site…',
    webSiteSearched: 'Searched the site',
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
    memDownBtn: 'Memory is not available right now; it keeps trying on its own',
    memBtnOff: 'Memory off in this chat: it neither reads nor saves memories. Press to turn it on.',
    forgetLearnt: (n) => (n === 1 ? 'Also forget the 1 thing I learnt here' : `Also forget the ${n} things I learnt here`),
    forgetFailed: 'I could not forget what I learnt here, so the chat is still here. Try again in a moment.',
    listKept: '(The list was shown to the user. Call memory.list again if you need it.)',
    anythingElse: 'Anything else?',
    webClose: 'This is what I found; you can read it in these sources:',
    webPartial: 'This is what I have found so far; you can read it in these sources:',
    webProgress: (host, n, of) => `Reading ${host}… (${n}/${of})`,
    webAsking: (n, of) => `Asking the search engines… (${n}/${of})`,
    webSlowTool: 'The search took too long and was cut short.',
    alreadyAbove: 'That result is already above: do not ask for it again. Answer the user now from what the results say, with their links.',
    answerNow: 'No more searches in this turn. Answer the user now from what the results above say, with their links.',
    digest: '(summary: read in full earlier in this turn)',
    stalled: 'The model stopped answering. Try again: it is loaded again if it has to be.',
    cutTool: 'The model ran out of room before it finished. Ask again, perhaps for something smaller.',
    appError: (m) => `The app hit an error: ${m}`,
    fixIt: 'Ask to fix it',
    fixAsk: (name, m) => `The app “${name}” shows this error: ${m}. Fix it.`,
    // Media tools and attachments
    mediaMaking: { image: 'Making a picture', audio: 'Making the audio', video: 'Making a video' },
    mediaKind: { image: 'Picture', audio: 'Audio', video: 'Video', doc: 'Document' },
    mediaStop: 'Stop',
    mediaDownload: 'Download',
    mediaGone: 'No longer in this browser.',
    mediaCannot: 'Not on this device',
    mediaDenied: 'Nothing was downloaded, so nothing was made.',
    mediaNeed: (verb, size) => `To ${verb}, ${size} has to be downloaded once.`,
    mediaNeedBtn: (verb) => `Download and ${verb}`,
    mediaVerb: { 'image.generate': 'make the picture', 'video.animate': 'animate it', 'video.generate': 'make the video', 'audio.music': 'make the music', 'audio.sfx': 'make the sound', 'audio.speak': 'read it aloud', 'image.describe': 'look at it' },
    mediaLooked: 'Looked at',
    madeFrom: 'Made from',
    looking: 'Looking at the picture…',
    unseen: (id, r) => `[${id}] (the picture could not be looked at${r ? `: ${r}` : ''}; if asked what it shows, say so and do not guess)`,
    onlyAttach: '(The user only sent this picture, with no text. Say in one or two sentences, in their language, what it shows. Do not call any tool.)',
    seenChips: ['Animate it', 'Make it a watercolour', 'What is in it?'],
    mediaHere: 'Made on this device. Kept in this browser.',
    mgTitle: { image: 'Download the picture model?', audio: 'Download the audio model?', video: 'Download the video model?', voice: 'Download the voice model?', vision: 'Download the model that looks at pictures?' },
    mgBody: 'It runs on this device, so nothing you ask for leaves it. The model is downloaded once and kept in this browser for every Elffuss app. While it works, the chat model steps aside and comes back after.',
    mgBtn: (size) => `Download ${size} and make it`,
    mgBtnVision: (size) => `Download ${size} and look`,
    mgBodyVision: 'It runs on this device, so the picture does not leave it. The model is downloaded once and kept in this browser for every Elffuss app; what a picture shows is kept with it.',
    noToolHere: 'No tool is needed: what the picture shows is above. Answer in plain text, in the user\'s language, in one or two sentences.',
    mgNo: 'Not now',
    attach: 'Attach',
    attReading: 'Reading…',
    attFailed: 'This file could not be read here.',
    attUnsupported: 'This kind of file cannot be attached.',
    attRemove: (n) => `Remove ${n}`,
    docPages: (n) => (n === 1 ? '1 page' : `${n} pages`),
    docChars: (n) => `${new Intl.NumberFormat('en-US').format(n)} characters`,
    docCut: (n) => `the model reads the first ${new Intl.NumberFormat('en-US').format(n)}`,
    attached: 'Here is what I attached.',
    recording: (s) => `Recording · ${s}`,
    recHint: 'Tap the microphone to send, or release it if you are holding it',
    recCancel: 'Discard the voice note',
    transcribing: 'Writing down your voice note…',
    voiceEmpty: 'Nothing could be heard in the voice note.',
    voiceNote: 'Voice note',
    micDenied: 'The microphone is not available: this browser did not allow it.',
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
    bootFailed: (why) => `El chat no ha terminado de arrancar (${why}). Recarga la página para intentarlo otra vez.`,
    stMissing: (size) => `${size} que descargar, una vez`,
    stReady: 'Listo en este dispositivo',
    stLoading: 'Cargando…',
    fineCached: (label) => `${label} ya está en este navegador: 0 bytes que descargar. Corre en este dispositivo y las conversaciones se guardan solo en este navegador.`,
    fineReady: (label) => `${label} está cargado y corre en este dispositivo. Las conversaciones se guardan solo en este navegador.`,
    fineMissing: (label, size) => `La primera respuesta necesita descargar una vez ${label}, ${size}. Corre en este dispositivo y las conversaciones se guardan solo en este navegador.`,
    fineCpu: 'Este navegador no tiene WebGPU utilizable, así que el modelo corre en el procesador: más despacio que en una tarjeta gráfica.',
    thinking: 'Pensando…',
    reading: (n) => `Leyendo · ${n} %`,
    speed: (r, rs, w, ws) => `Leyó ${r} tokens a ${rs} tok/s · escribió ${w} a ${ws} tok/s`,
    speedCached: (c) => ` (${c} ya en memoria)`,
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
    makeApp: 'Crear como app',
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
    webSentRead: (n) => `Solo estas palabras han salido de este dispositivo, hacia DuckDuckGo, y ${n === 1 ? 'la dirección de la página que se leyó' : 'las direcciones de las ' + n + ' páginas que se leyeron'} para responder.`,
    webSentSite: (n) => `Solo las palabras de la búsqueda y ${n === 1 ? 'esta dirección han' : 'estas ' + n + ' direcciones han'} salido de este dispositivo, para leer esa web (con su robots.txt).`,
    webSentList: 'Lo que ha salido de este dispositivo',
    webSent: ({ engine, ddg, pages, site }) => {
      const to = engine && ddg ? 'a nuestro propio buscador (Elffuss), que pregunta a varios buscadores, y como respaldo a DuckDuckGo'
        : engine ? 'a nuestro propio buscador (Elffuss), que pregunta a varios buscadores' : ddg ? 'a DuckDuckGo' : '';
      const words = to ? `las palabras de la búsqueda, ${to}` : (site ? 'las palabras de la búsqueda' : '');
      const addr = pages ? `${pages === 1 ? 'una dirección' : pages + ' direcciones'} para leer ${site ? 'esa web (con su robots.txt)' : 'las páginas que responden'}` : '';
      return `Solo ha salido de este dispositivo: ${[words, addr].filter(Boolean).join('; y ')}.`;
    },
    webSiteSearching: 'Buscando en la web…',
    webSiteSearched: 'Búsqueda dentro de la web',
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
    memDownBtn: 'La memoria no está disponible ahora; se reintenta sola',
    memBtnOff: 'Memoria apagada en esta conversación: ni lee ni guarda recuerdos. Pulsa para encenderla.',
    forgetLearnt: (n) => (n === 1 ? 'Olvidar también la cosa que aprendí aquí' : `Olvidar también las ${n} cosas que aprendí aquí`),
    forgetFailed: 'No he podido olvidar lo que aprendí aquí, así que el chat sigue aquí. Inténtalo dentro de un momento.',
    listKept: '(La lista se le mostró al usuario. Vuelve a llamar a memory.list si la necesitas.)',
    anythingElse: '¿Algo más?',
    webClose: 'Esto es lo que he encontrado; puedes leerlo en estas fuentes:',
    webPartial: 'Esto es lo que he encontrado hasta ahora; puedes leerlo en estas fuentes:',
    webProgress: (host, n, of) => `Leyendo ${host}… (${n}/${of})`,
    webAsking: (n, of) => `Preguntando a los buscadores… (${n}/${of})`,
    webSlowTool: 'La búsqueda tardó demasiado y se cortó.',
    alreadyAbove: 'Ese resultado ya está arriba: no lo pidas otra vez. Responde ahora al usuario con lo que dicen los resultados, con sus enlaces.',
    answerNow: 'No quedan más búsquedas en este turno. Responde ahora al usuario con lo que dicen los resultados de arriba, con sus enlaces.',
    digest: '(resumen: se leyó entero antes en este turno)',
    stalled: 'El modelo ha dejado de responder. Vuelve a intentarlo: se carga otra vez si hace falta.',
    cutTool: 'El modelo se quedó sin margen antes de terminar. Pídelo otra vez, quizá algo más pequeño.',
    appError: (m) => `La app ha dado un error: ${m}`,
    fixIt: 'Pedir que lo arregle',
    fixAsk: (name, m) => `La app «${name}» da este error: ${m}. Arréglalo.`,
    mediaMaking: { image: 'Haciendo una imagen', audio: 'Haciendo el audio', video: 'Haciendo un vídeo' },
    mediaKind: { image: 'Imagen', audio: 'Audio', video: 'Vídeo', doc: 'Documento' },
    mediaStop: 'Parar',
    mediaDownload: 'Descargar',
    mediaGone: 'Ya no está en este navegador.',
    mediaCannot: 'No en este dispositivo',
    mediaDenied: 'No se ha descargado nada, así que no se ha hecho.',
    mediaNeed: (verb, size) => `Para ${verb} hace falta descargar ${size} una vez.`,
    mediaNeedBtn: (verb) => `Descargar y ${verb}`,
    mediaVerb: { 'image.generate': 'hacer la imagen', 'video.animate': 'animarla', 'video.generate': 'hacer el vídeo', 'audio.music': 'hacer la música', 'audio.sfx': 'hacer el sonido', 'audio.speak': 'leerlo en voz alta', 'image.describe': 'mirarla' },
    mediaLooked: 'Vista',
    madeFrom: 'Hecha desde',
    looking: 'Mirando la imagen…',
    unseen: (id, r) => `[${id}] (no se pudo describir la imagen${r ? `: ${r}` : ''}; si te preguntan qué muestra, dilo así y no lo inventes)`,
    onlyAttach: '(El usuario solo ha enviado esta imagen, sin texto. Di en una o dos frases, en su idioma, lo que se ve en ella. No llames a ninguna herramienta.)',
    seenChips: ['Anímala', 'Hazla en acuarela', '¿Qué hay en ella?'],
    mediaHere: 'Hecho en este dispositivo. Guardado en este navegador.',
    mgTitle: { image: '¿Descargar el modelo de imágenes?', audio: '¿Descargar el modelo de audio?', video: '¿Descargar el modelo de vídeo?', voice: '¿Descargar el modelo de voz?', vision: '¿Descargar el modelo que mira las imágenes?' },
    mgBody: 'Corre en este dispositivo, así que lo que pides no sale de él. El modelo se descarga una vez y queda en este navegador para todas las apps de Elffuss. Mientras trabaja, el modelo del chat se aparta y vuelve después.',
    mgBtn: (size) => `Descargar ${size} y hacerlo`,
    mgBtnVision: (size) => `Descargar ${size} y mirarla`,
    mgBodyVision: 'Corre en este dispositivo, así que la imagen no sale de él. El modelo se descarga una vez y queda en este navegador para todas las apps de Elffuss; lo que muestra una imagen se guarda con ella.',
    noToolHere: 'No hace falta ninguna herramienta: lo que se ve en la imagen está arriba. Responde con texto, en el idioma del usuario, en una o dos frases.',
    mgNo: 'Ahora no',
    attach: 'Adjuntar',
    attReading: 'Leyendo…',
    attFailed: 'No se ha podido leer este archivo aquí.',
    attUnsupported: 'Este tipo de archivo no se puede adjuntar.',
    attRemove: (n) => `Quitar ${n}`,
    docPages: (n) => (n === 1 ? '1 página' : `${n} páginas`),
    docChars: (n) => `${new Intl.NumberFormat('es-ES').format(n)} caracteres`,
    docCut: (n) => `el modelo lee los primeros ${new Intl.NumberFormat('es-ES').format(n)}`,
    attached: 'Te adjunto esto.',
    recording: (s) => `Grabando · ${s}`,
    recHint: 'Toca el micrófono para enviar, o suéltalo si lo mantienes pulsado',
    recCancel: 'Descartar la nota de voz',
    transcribing: 'Escribiendo tu nota de voz…',
    voiceEmpty: 'No se ha oído nada en la nota de voz.',
    voiceNote: 'Nota de voz',
    micDenied: 'El micrófono no está disponible: este navegador no lo ha permitido.',
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
let voice = null;                    // the voice mode (voice.js), once the device can run the chat
let voiceGateOk = false;             // the voice mode's first-use question already said yes to the chat model's download
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
// And on the first visit, the snapshot computed once by us (UtopiaIA/elffuss-prefixes, named by its key): the first
// letter no longer waits for the system prompt to be read. On the CPU that was 6.2 s → 0.56 s on a computer, and minutes
// on a tablet. The engine checks it token by token and only takes a file that matches what it would compute.
globalThis.__ELFFUSS_PREFIJO_REMOTO = 'https://huggingface.co/UtopiaIA/elffuss-prefixes/resolve/main/';
const model = () => (device.id ? MODELS[device.id] : null);
const modelUrl = () => { const m = model(); return m && !Array.isArray(m.url) ? m.url : null; };

// Every wait of the start has a limit. A frame or a browser call that never answers (an iPhone's Safari left a tab with
// no model chip and no voice control) must not stop the page: on a timeout the start goes on with a fallback and says
// so in the console. `job` is a promise or a function that returns one (a throw counts as a failure).
function within(job, ms, fallback, what) {
  return new Promise((resolve) => {
    let over = false;
    const fall = (why) => { if (over) return; over = true; clearTimeout(timer); console.warn(`[chat] ${what}: ${why}; going on without it`); resolve(typeof fallback === 'function' ? fallback() : fallback); };
    const timer = setTimeout(() => fall(`no answer in ${ms} ms`), ms);
    let p;
    try { p = Promise.resolve(typeof job === 'function' ? job() : job); } catch (e) { fall(e?.message || String(e)); return; }
    p.then((v) => { if (over) return; over = true; clearTimeout(timer); resolve(v); }, (e) => fall(e?.message || String(e)));
  });
}
const BOOT_MS = { chat: 5000, adapter: 8000, device: 10000, sw: 4000, isolate: 8000, shared: 6000, opfs: 3000, cached: 10000 };

// ---------- Device ----------
// Without a usable WebGPU the engine runs the QAD-Q4_0 on the processor (WebAssembly SIMD, in a Worker): slower than
// the graphics card, but it answers instead of showing «this browser cannot». The probe is the smallest module that
// uses a SIMD instruction; a browser without SIMD fails it and keeps the old screen.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const cpuCan = () => { try { return typeof Worker === 'function' && WebAssembly.validate(SIMD_PROBE); } catch { return false; } };
// `?cpu` in the address forces the processor even where WebGPU works: to try, on any device, what a browser without
// it gets.
// On a phone or a tablet it takes `?cpu=force`: a stale `?cpu` (from a shared link, a bookmark, an app added to the
// home screen from that address) kept an iPhone whose graphics card works on the processor, several times slower.
// There a plain `?cpu` is ignored and taken out of the address, so a reload or the home-screen app does not bring it
// back.
const CPU_ASKED = /[?&]cpu(=|&|$)/.test(location.search);
const TOUCH_DEVICE = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 || navigator.userAgentData?.mobile === true || /Mobi|iPhone|iPad|Android/i.test(navigator.userAgent);
const FORCE_CPU = CPU_ASKED && (!TOUCH_DEVICE || /[?&]cpu=force(&|$)/.test(location.search));
if (CPU_ASKED && !FORCE_CPU) {
  try { const u = new URL(location.href); u.searchParams.delete('cpu'); history.replaceState(history.state, '', u); } catch { /* — */ }
  console.info('[chat] ?cpu ignored on a touch device (use ?cpu=force to try the processor here)');
}
async function pickDevice() {
  if (FORCE_CPU && cpuCan() && MODELS['lfm3-1.7b-q4']) return { ok: true, id: 'lfm3-1.7b-q4', cpu: true, why: '' };
  const r = await pickGpu();
  if (r.ok || !cpuCan() || !MODELS['lfm3-1.7b-q4']) return r;
  return { ok: true, id: 'lfm3-1.7b-q4', cpu: true, why: r.why };
}
async function pickGpu() {
  if (!navigator.gpu) return { ok: false, why: 'whyNoWebgpu' };
  let a = null;
  a = await within(() => navigator.gpu.requestAdapter(), BOOT_MS.adapter, null, 'the graphics card (requestAdapter)');
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

// On the processor the engine uses several cores only on an isolated page (COOP/COEP): on a tablet without WebGPU,
// two cores read and wrote ×1.6 faster. The site cannot send those headers for one kind of device, so a small service
// worker (../coi-sw.js) adds them to this page, and only on devices that run on the CPU. Isolated, the page cannot
// embed the shared model store or the shared memory, which live on other sites: the model is kept in this site's own
// store (one more download, once) and the memory stays off. Returns true when the page is about to reload isolated.
const COI_TRIED = 'elffuss.coi.tried';
// On by default on computers only: there the CPU path with 8 threads read a ~1,200-token prompt ×6 faster and wrote
// ×3.5 faster than with one, the same text. Off on phones and tablets (an iPad says it is a Mac, so a touch screen
// counts as a tablet) and on devices that report under 8 GB: on the first tablet try the tab started over while
// loading the model. ?coi=1 turns it on anywhere, for testing.
const TABLET = matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 1 || navigator.userAgentData?.mobile === true || /Mobi/i.test(navigator.userAgent);
const ISOLATE_CPU = /[?&]coi=1(&|$)/.test(location.search) ||
  (!TABLET && !((navigator.deviceMemory || 8) < 8));
async function isolateForCpu() {
  const sw = navigator.serviceWorker;
  if (!sw) return false;
  if (!ISOLATE_CPU && device.cpu) return false;
  if (!device.cpu) {
    // A device that now has a usable WebGPU leaves the isolation behind (it takes effect on the next load).
    try { for (const r of await within(() => sw.getRegistrations(), BOOT_MS.sw, [], 'the service workers')) if (/\/coi-sw\.js$/.test(r.active?.scriptURL || '')) r.unregister(); } catch { /* — */ }
    return false;
  }
  if (self.crossOriginIsolated) return false;
  try { if (sessionStorage.getItem(COI_TRIED)) return false; sessionStorage.setItem(COI_TRIED, '1'); } catch { return false; }
  try {
    await sw.register(new URL('../coi-sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname });
    if (!(await within(sw.ready.then(() => true), BOOT_MS.sw, false, 'the isolating service worker'))) return false;
    location.reload();
    return true;
  } catch (e) {
    console.warn('[chat] could not isolate the page for the CPU:', e?.message || e);
    return false;
  }
}
// The shared store is on another site, which an isolated page cannot embed: this site's own store, without waiting.
if (self.crossOriginIsolated) try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* — */ }

// Is the model already stored? The shared store of the Elffuss sites first, then this site's own copy. Neither
// question downloads any weights.
const keyFor = (url) => String(url).replace(/[?#].*$/, '').replace(/[^\w.\-]+/g, '_').slice(-180);
async function isCached() {
  const m = model(); const url = modelUrl();
  if (!m || !url || !cachea(m)) return false;
  if (!mirror && !self.crossOriginIsolated) try {
    const { isSharedCached } = await import('./js/runtime/model-broker.js');
    if (await within(() => isSharedCached(url), BOOT_MS.shared, false, 'the shared model store')) return true;
  } catch { /* the shared store is not reachable */ }
  return within(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
    await dir.getFileHandle(keyFor(url) + '.done');
    return true;
  }, BOOT_MS.opfs, false, 'this site\'s model store');
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
  autoGroups(all.length);
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
    removeChatMedia(c.id).catch(() => {});
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
    if (m.role === 'user') appendUser(m.content, m.attach);
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

function appendUser(text, attach = null) {
  const li = document.createElement('li');
  li.className = 'msg msg-user';
  if (attach?.length) {
    const box = el('div', 'att-sent');
    for (const a of attach) box.append(attachmentCard(a));
    li.append(box);
  }
  if (text) {
    const b = document.createElement('div');
    b.className = 'bubble'; b.textContent = text;
    li.append(b);
  }
  ui.thread.append(li);
  return li;
}

// An attachment as it shows in the user's message: the photo, the video or the voice note itself, or a document's
// card (name, pages, how much the model reads), each with its id, which is how the model refers to it.
function attachmentCard(a) {
  const card = el('div', 'att-card att-' + a.kind);
  card.dataset.media = a.id;
  if (a.kind === 'doc') {
    card.insertAdjacentHTML('afterbegin', svg('i-doc', 'ic att-ic'));
    const body = el('div', 'att-body');
    body.append(el('b', 'att-name', a.name));
    const facts = [a.meta?.pages ? t('docPages', a.meta.pages) : null, a.meta?.chars != null ? t('docChars', a.meta.chars) : null,
      a.meta?.truncated ? t('docCut', a.meta.read || 0) : null].filter(Boolean).join(' · ');
    if (facts) body.append(el('span', 'att-line', facts));
    body.append(el('span', 'att-id', a.id));
    card.append(body);
    return card;
  }
  const holder = mediaElement(a.kind, a.id, a.name);
  if (a.source === 'voice') card.append(el('span', 'att-line', t('voiceNote') + (a.meta?.seconds ? ` · ${clockOf(a.meta.seconds)}` : '')));
  if (a.source === 'voice' && a.meta?.peaks?.length) card.append(peaksCanvas(a.meta.peaks));
  card.append(holder, el('span', 'att-id', a.id));
  return card;
}

const clockOf = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// The <img>, <audio> or <video> of a stored media item, filled once its bytes are read from this browser.
function mediaElement(kind, id, label = '') {
  const node = kind === 'image' ? document.createElement('img') : document.createElement(kind === 'audio' ? 'audio' : 'video');
  node.className = 'media-el';
  if (kind === 'image') { node.alt = label || id; node.decoding = 'async'; } else { node.controls = true; node.preload = 'metadata'; if (kind === 'video') node.playsInline = true; }
  mediaUrl(id).then((u) => { if (u) node.src = u; else node.replaceWith(el('span', 'tc-line', t('mediaGone'))); }).catch(() => {});
  return node;
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

// The last finished sentence of the reasoning so far (the one being written may stop mid-word), or ''.
function thinkingNow(text) {
  // A sentence ends at a line break or at «. » with a space after it: «web.search» does not end one.
  const parts = text.trim().split(/(?<=[.!?]["»)\]]?)\s+|\n+/);
  parts.pop();
  const last = parts.map((x) => x.trim()).filter((x) => x.length > 8).pop() || '';
  return last.replace(/[*_`#]/g, '');
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
    const sum = think.querySelector('summary');
    sum.textContent = thinkingLive ? t('thinking') : t('reasoning');
    // While it thinks, the folded line says what about: the last whole sentence of the reasoning. A silent «Thinking…»
    // for twenty seconds read as a hang.
    const now = thinkingLive ? thinkingNow(m.thinking) : '';
    if (now) sum.append(' ', el('span', 'think-now', now));
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
  li.querySelector('.speed')?.remove();
  if (m.stopped) {
    const s = document.createElement('span'); s.className = 'stamp'; s.textContent = t('stopped'); li.append(s);
  }
  if (m.note) {
    const n = document.createElement('p'); n.className = 'note'; n.textContent = t(m.note); li.append(n);
  }
  // After a picture sent alone: what to do with it, each chip sends its words.
  li.querySelector('.seen-chips')?.remove();
  if (m.seenChips && !writing && (!chat?.messages?.includes(m) || chat.messages[chat.messages.length - 1] === m)) {
    const row = el('div', 'seen-chips');
    for (const words of t('seenChips')) {
      const b = el('button', 'mini-btn', words); b.type = 'button'; b.dataset.seenChip = '';
      b.addEventListener('click', () => { row.remove(); send(words, { typed: true }); }, { once: true });
      row.append(b);
    }
    li.append(row);
  }
  // An app the model wrote on a turn that asked for none: shown as code, and built only if the user presses this.
  li.querySelector('.make-app')?.remove();
  if (m.offerApp && !writing) {
    const b = el('button', 'mini-btn make-app', t('makeApp'));
    b.type = 'button'; b.dataset.makeApp = '';
    b.addEventListener('click', () => makeOfferedApp(li, m), { once: true });
    li.append(b);
  }
  // How fast this step ran on this device: what it read (the prompt the model had not seen yet) and what it wrote.
  if (m.speed && !writing) {
    const v = m.speed, n = (x) => Math.round(x).toLocaleString(lang);
    const p = document.createElement('p'); p.className = 'speed';
    p.textContent = t('speed', n(v.read), n(v.readTokS), n(v.wrote), n(v.wroteTokS)) + (v.cached ? t('speedCached', n(v.cached)) : '');
    li.append(p);
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
const hostOf = (u) => { try { return new URL(u).host; } catch { try { return new URL('https://' + u).host; } catch { return String(u || ''); } } };
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
  if (c.tool === 'web.search' || c.tool === 'web.fetch' || c.tool === 'web.site') {
    const search = c.tool === 'web.search', inSite = c.tool === 'web.site';
    card.classList.add('card-list', 'card-web');
    card.insertAdjacentHTML('afterbegin', svg('i-external', 'ic tc-ic'));
    const kicker = r.pending ? (inSite ? t('webSiteSearching') : search ? t('webSearching') : t('webReading'))
      : r.error ? t('toolFailed') : inSite ? t('webSiteSearched') : search ? t('webSearched') : t('webRead');
    body.append(el('span', 'tc-kicker', kicker));
    const title = inSite ? `${hostOf(r.site || c.url || '')} · ${r.query || c.query || ''}` : search ? (r.query || c.query || '') : (r.url || c.url || '');
    body.append(el('b', 'tc-title', title));
    // While it runs: which address it is reading, and how many of its requests have gone.
    if (r.pending && m.webLive?.url) {
      const w = m.webLive, own = w.url.startsWith(location.origin + '/websearch');
      body.append(el('span', 'tc-line tc-live', own ? t('webAsking', w.n, w.of) : t('webProgress', hostOf(w.url), w.n, w.of)));
    }
    if (r.error) body.append(el('span', 'tc-line', r.error));
    else if (!r.pending && (search || inSite)) {
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
    // What left the device, said exactly: the search words, and every address the proxy was asked for (robots.txt,
    // the site's search, the pages read). A chat saved before this change has no `sent` and keeps its old line.
    if (!r.pending && !r.error) {
      const sent = Array.isArray(r.sent) ? r.sent : null;
      const isDdg = (u) => /^https:\/\/(html|lite)\.duckduckgo\.com\//.test(u);
      const isEngine = (u) => /^https:\/\/[^/]+\/websearch\?/.test(u) && u.startsWith(location.origin);
      const pages = sent ? sent.filter((u) => !isDdg(u) && !isEngine(u)) : [];
      // A chat saved before /websearch keeps the lines it was shown with.
      const line = sent && (sent.some(isEngine) || inSite)
        ? t('webSent', { engine: sent.some(isEngine), ddg: sent.some(isDdg), pages: pages.length, site: inSite })
        : inSite && sent ? t('webSentSite', pages.length)
        : search && pages.length ? t('webSentRead', pages.length)
        : search ? t('webSentSearch') : t('webSentUrl');
      body.append(el('span', 'tc-line', line));
      if (sent && sent.length > 1) {
        const d = el('details', 'tc-sent');
        d.append(el('summary', null, `${t('webSentList')} (${sent.length})`));
        const ul = el('ul', 'tc-items');
        for (const u of sent) ul.append(el('li', 'tc-url', u));
        d.append(ul);
        body.append(d);
      }
    }
    card.append(body);
    if (r.error) card.classList.add('is-error');
    return;
  }
  if (isMediaTool(c.tool)) { paintMediaCard(li, card, body, m, r, c); return; }
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
  voice?.attention();
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
// Prose around the ```html block (not just a line before it): the model is explaining, the block is an example.
function explainsCode(text) {
  const outside = String(text).replace(/```html[\s\S]*?(```|$)/gi, ' ').replace(/[#*_`>|\-\s]+/g, ' ').trim();
  return outside.length > 120;
}

// The model must not be able to write the context's own blocks into its answer (measured: LFM3 closed an answer
// with a made-up <memoria> fact). They are removed from what is shown and kept, closed or cut off.
const ECHO = /<(memoria|memory|contexto|context)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi;
const stripEcho = (s) => String(s || '').replace(ECHO, '').replace(/\n{3,}/g, '\n\n').trim();

// The close of a turn that ended on web results: one sentence in the chat's language and up to five sources.
function webClose(sources, partial = false) {
  if (!sources.length) return t('anythingElse');
  const md = (s) => s.replace(/[[\]]/g, '').slice(0, 120);
  return t(partial ? 'webPartial' : 'webClose') + '\n' + sources.slice(0, 5).map((s) => `- [${md(s.title)}](${s.url})`).join('\n');
}

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
  else if (a.site != null) s.url = String(a.site).slice(0, 500);
  if (isMediaTool(call.tool)) {
    if (a.prompt != null) s.prompt = String(a.prompt).slice(0, 300);
    if (a.text != null) s.text = String(a.text).slice(0, 300);
    if (a.image != null) s.image = String(a.image).slice(0, 40);
    for (const k of ['start', 'end']) if (a[k] != null) s[k] = String(a[k]).slice(0, 40);
    for (const k of ['seconds', 'strength']) if (Number.isFinite(Number(a[k])) && a[k] !== '' && a[k] != null) s[k] = Number(a[k]);
  }
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
      // A small model often leaves the name out when it rewrites the app open in the panel: that is the one it means.
      // With no app open, the page's <title> names it.
      if (!name && html.trim()) name = panel.openName() || cleanName(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]);
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
      // No name while an app is open ("fix it", "what does it do"): the model wants that app. It reads its HTML and how
      // to save a new version, and the turn goes on, instead of an error the visitor cannot act on.
      if (!name && panel.openName()) {
        const open = panel.openName();
        const err = panel.lastError();
        const text = es
          ? `La app «${open}» está abierta en el panel${err ? ` y da este error: ${err}` : ''}. Su HTML:\n\`\`\`html\n${panel.openHtml() || ''}\n\`\`\`\nPara cambiarla o arreglarla, llama a app.create con name «${open}» y el HTML completo nuevo.`
          : `The app “${open}” is open in the panel${err ? ` and shows this error: ${err}` : ''}. Its HTML:\n\`\`\`html\n${panel.openHtml() || ''}\n\`\`\`\nTo change or fix it, call app.create with name “${open}” and the whole new HTML.`;
        ctx.summary.name = open;
        return { text, result: { name: open, saved: true } };
      }
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
        // The question ranks the passages of the pages read, here on the device; it is not sent anywhere.
        const r = await web.search(query, { es, signal: ctx.signal, question: ctx.userText, onProgress: ctx.webProgress });
        return { text: r.text, result: { query, items: r.items, sent: r.sent } };
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
        const r = await web.fetchPage(url, { es, signal: ctx.signal, question: [a.question, ctx.userText].filter(Boolean).join(' '), onProgress: ctx.webProgress });
        return { text: r.text, result: { url, title: r.title, sent: r.sent } };
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        return { text: 'ERROR: ' + (e?.message || e), result: { url, error: String(e?.message || e) } };
      }
    }
    case 'web.site': {
      if (mirror) return fail(t('webOff'));
      const site = String(a.url ?? a.site ?? a.domain ?? '').trim().slice(0, 500);
      const query = String(a.query ?? a.q ?? a.text ?? a.search ?? '').trim().slice(0, 300);
      ctx.summary.url = site; ctx.summary.query = query;
      try {
        const r = await web.siteSearch(site, query, { es, signal: ctx.signal, question: ctx.userText, onProgress: ctx.webProgress });
        return { text: r.text, result: { site: r.site, query, items: r.items, sent: r.sent, via: r.via } };
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        return { text: 'ERROR: ' + (e?.message || e), result: { site, query, error: String(e?.message || e) } };
      }
    }
    default:
      if (isMediaTool(call.tool) && !mirror) return runMedia(call, ctx);
      return fail(es ? `Herramienta desconocida: ${call.tool}` : `Unknown tool: ${call.tool}`);
  }
}

// ---------- Media tools ----------
// The SDK copy is this site's /vendor/elffuss-ai/ (ai-sync.mjs). One media task at a time; while it runs the chat
// model is unloaded (its graphics memory goes to the task: a phone tab has about 2 GB), and it is loaded again after.
const AI_BASE = new URL('../vendor/elffuss-ai/', import.meta.url);
let preApproved = false;             // the next download question is already answered «yes» (a card's retry button)
let mediaUi = null;                  // { li, signal } of the step running a media tool: where its question goes
const media = createMediaTools({
  base: AI_BASE,
  lang: () => lang,
  unloadLlm,
  reloadLlm: () => (device.ok ? loadEngine() : null),
  // The download question in the message that asked; a retry from a card has already said yes. Never a silent «no»:
  // with no step to show it in, it goes under the newest answer (it used to answer false, and the card then said
  // «nothing was downloaded» without anyone being asked).
  // On an iPhone or iPad tab the install screen comes first (install.js installGate): «I will install it» downloads nothing.
  consent: async (q) => {
    if (!(await installGate())) { preApproved = false; return false; }
    if (preApproved) { preApproved = false; return true; }
    if (mediaUi) return untilStopped(mediaGate(mediaUi.li, q, mediaUi.signal), mediaUi.signal);
    const li = [...ui.thread.querySelectorAll('.msg-bot')].pop();
    return li ? mediaGate(li, q, null) : Promise.resolve(false);
  },
});

// Lets the model go from the graphics card, as a hidden tab does (watchHidden), and waits until it is gone.
async function unloadLlm() {
  if (releasing) { await releasing; return; }
  if (!loading) return;
  try { await loading; } catch { return; }
  loading = null;
  releasing = (engine?.unload?.() || Promise.resolve()).catch(() => {}).finally(() => { releasing = null; });
  await releasing;
  setModelState('cached');
}

async function runMedia(call, ctx) {
  mediaUi = { li: ctx.li, signal: ctx.signal };
  try {
    const r = await media.run(call, { signal: ctx.signal, chat: chat?.id || null, lang, onProgress: ctx.progress });
    for (const k of ['prompt', 'text', 'image']) if (r.result?.[k] != null) ctx.summary[k] = r.result[k];
    return r;
  } finally { mediaUi = null; }
}

// The «Crear como app» button of a page shown as code (see runTurn): builds it as app.create would, in that message.
async function makeOfferedApp(li, m) {
  const html = /```html\n([\s\S]*?)\n```/.exec(m.content || '')?.[1] || '';
  if (!html.trim() || turn) return;
  const mine = chat;
  const call = { tool: 'app.create', args: { name: m.offerApp?.name || '', html } };
  const summary = callSummary(call);
  const ctl = new AbortController();
  const ctx = { userText: '', summary, memory: null, signal: ctl.signal, li, progress: () => {},
    ask: (scope, detail) => requirePerm(scope, detail, li, ctl.signal), askMemory: async () => null };
  const res = await runTool(call, ctx);
  delete m.offerApp;
  const step = { role: 'assistant', content: '', thinking: '', call: summary, result: res.result };
  const card = appendBot();
  paintBot(card, step);
  paintBot(li, m);
  if (mine) {
    mine.messages.push(step, { role: 'user', content: `[result app.create]\n${res.text}`, meta: 'result' });
    mine.updated = Date.now();
    await store.put(mine);
  }
}

// The download question of a media model, the chat's own download plate: what, how much, and two buttons.
function mediaGate(li, q, signal) {
  voice?.attention();
  return new Promise((resolve, reject) => {
    const box = el('div', 'gate media-gate');
    box.setAttribute('role', 'group');
    const paint = () => {
      box.textContent = '';
      const h = el('h2', null, t('mgTitle')[q.kind] || t('mgTitle').image);
      const p = el('p', null, q.kind === 'vision' ? t('mgBodyVision') : t('mgBody'));
      const size = el('p', 'size');
      size.append(el('b', null, formatBytes(q.bytes, lang)), el('span', null, t('bytes', num(q.bytes))));
      const yes = el('button', 'btn'); yes.type = 'button'; yes.dataset.mediaYes = '';
      yes.innerHTML = svg('i-down');
      yes.append(document.createTextNode(q.kind === 'voice' ? t('gateBtn', formatBytes(q.bytes, lang)) : q.kind === 'vision' ? t('mgBtnVision', formatBytes(q.bytes, lang)) : t('mgBtn', formatBytes(q.bytes, lang))));
      const no = el('button', 'mini-btn ask-no', t('mgNo')); no.type = 'button'; no.dataset.mediaNo = '';
      yes.addEventListener('click', () => finish(true), { once: true });
      no.addEventListener('click', () => finish(false), { once: true });
      const row = el('div', 'ask-row'); row.append(yes, no);
      box.append(h, p, size, row);
      box.setAttribute('aria-label', h.textContent);
    };
    const finish = (ok) => { repaints.delete(paint); box.remove(); resolve(ok); };
    live(paint);
    li.append(box);
    scrollEnd(true);
    box.querySelector('.btn').focus({ preventScroll: true });
    signal?.addEventListener('abort', () => { repaints.delete(paint); box.remove(); reject(Object.assign(new Error('stopped'), { name: 'AbortError' })); }, { once: true });
  });
}

// The progress of a media task, painted into its card without repainting the rest of it.
function paintMediaProgress(li, p) {
  const card = li.querySelector('.tool-card.card-media');
  if (!card) return;
  const line = card.querySelector('.tc-progress');
  const meter = card.querySelector('.meter');
  if (line) line.textContent = p.text;
  // A story video: its keyframes appear as they are made, small, in order; the shots that follow light them up.
  const st = p.story;
  if (st && (st.stage === 'keyframe' || st.stage === 'clip')) {
    let strip = card.querySelector('.tc-story');
    if (!strip) { strip = el('div', 'tc-story'); strip.setAttribute('aria-hidden', 'true'); (meter || line || card).after(strip); }
    if (st.stage === 'keyframe' && st.done && st.image?.rgba && !strip.querySelector(`[data-k="${st.index}"]`)) {
      const c = document.createElement('canvas');
      c.dataset.k = String(st.index);
      const w = 96, h = Math.max(1, Math.round((96 * st.image.height) / st.image.width));
      c.width = w; c.height = h;
      try {
        const src = new ImageData(new Uint8ClampedArray(st.image.rgba), st.image.width, st.image.height);
        createImageBitmap(src).then((bm) => { c.getContext('2d').drawImage(bm, 0, 0, w, h); bm.close?.(); }).catch(() => {});
      } catch { /* a picture this browser cannot draw: the strip goes on without it */ }
      const kids = [...strip.children];
      const after = kids.find((x) => Number(x.dataset.k) > st.index);
      strip.insertBefore(c, after || null);
    }
    if (st.stage === 'clip') for (const k of strip.children) k.classList.toggle('is-shot', Number(k.dataset.k) <= st.index + (st.done ? 1 : 0));
  }
  if (meter) {
    meter.classList.toggle('is-busy', p.pct == null);
    meter.querySelector('i').style.width = (p.pct ?? 0) + '%';
    if (p.pct == null) meter.removeAttribute('aria-valuenow'); else meter.setAttribute('aria-valuenow', String(p.pct));
  }
}

function paintMediaCard(li, card, body, m, r, c) {
  const kind = mediaKindOf(c.tool) || 'image';
  card.classList.add('card-media');
  card.insertAdjacentHTML('afterbegin', svg(kind === 'image' ? 'i-image' : kind === 'audio' ? 'i-audio' : 'i-video', 'ic tc-ic'));
  const what = c.prompt || c.text || '';
  if (r.pending) {
    body.append(el('span', 'tc-kicker', t('mediaMaking')[kind]));
    if (what) body.append(el('b', 'tc-title', what));
    const line = el('span', 'tc-line tc-progress', m.live?.text || '');
    line.setAttribute('aria-live', 'polite');
    const meter = el('div', 'meter is-busy');
    meter.setAttribute('role', 'progressbar'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
    meter.append(el('i'));
    body.append(line, meter);
    card.append(body);
    const acts = el('div', 'tc-actions');
    const stop = el('button', 'mini-btn', t('mediaStop')); stop.type = 'button'; stop.dataset.mediaStop = '';
    stop.addEventListener('click', () => stopTurn());
    acts.append(stop);
    card.append(acts);
    if (m.live) paintMediaProgress(li, m.live);
    return;
  }
  if (r.media) {
    body.append(el('span', 'tc-kicker', `${t('mediaKind')[r.media.kind] || ''} · ${r.media.id}`));
    // Made from another picture: which one, small.
    const from = c.tool === 'image.generate' ? (c.image || r.image) : c.tool === 'video.generate' ? (c.start || c.end) : null;
    if (from) {
      const f = el('span', 'tc-from');
      f.append(document.createTextNode(t('madeFrom') + ' '));
      const im = mediaElement('image', from, from);
      im.classList.add('tc-from-img');
      f.append(im, document.createTextNode(' ' + from));
      body.append(f);
    }
    if (what) body.append(el('b', 'tc-title', what));
    body.append(el('span', 'tc-line', t('mediaHere')));
    card.append(body);
    const acts = el('div', 'tc-actions');
    const a = el('a', 'mini-btn tc-download');
    a.innerHTML = svg('i-down');
    a.append(document.createTextNode(t('mediaDownload')));
    a.download = downloadName(r.media);
    acts.append(a);
    card.append(acts);
    const fig = el('figure', 'tc-media');
    fig.append(mediaElement(r.media.kind, r.media.id, what));
    card.append(fig);
    card.dataset.media = r.media.id;
    mediaUrl(r.media.id).then((u) => { if (u) a.href = u; else a.remove(); }).catch(() => {});
    return;
  }
  if (r.described) {
    // Looked at again (image.describe): what the model read, in a short card, not an error.
    body.append(el('span', 'tc-kicker', `${t('mediaLooked')} · ${c.image || r.image || ''}`));
    body.append(el('span', 'tc-line', [r.described.caption, r.described.text && `«${r.described.text}»`].filter(Boolean).join(' ').slice(0, 300)));
    card.append(body);
    return;
  }
  if (r.denied) {
    // The download was not agreed: say what it takes, and offer to do it now (the same call, already agreed).
    const verb = t('mediaVerb')[c.tool] || t('mediaVerb')['image.generate'];
    body.append(el('span', 'tc-kicker', t('mediaKind')[kind] || ''));
    if (what) body.append(el('b', 'tc-title', what));
    body.append(el('span', 'tc-line', r.need ? t('mediaNeed', verb, formatBytes(r.need, lang)) : t('mediaDenied')));
    card.append(body);
    const acts = el('div', 'tc-actions');
    const b = el('button', 'mini-btn', t('mediaNeedBtn', verb)); b.type = 'button'; b.dataset.mediaRetry = '';
    b.addEventListener('click', () => retryMedia(li, m), { once: true });
    acts.append(b);
    card.append(acts);
    return;
  }
  card.classList.add('is-error');
  body.append(el('span', 'tc-kicker', r.cannot ? t('mediaCannot') : t('toolFailed')));
  if (what) body.append(el('b', 'tc-title', what));
  body.append(el('span', 'tc-line', r.error || ''));
  card.append(body);
}

// «Descargar y animarla» on a card whose download was not agreed: the same call again, the download already agreed,
// in the same card. The card is the answer, as it would have been.
async function retryMedia(li, m) {
  if (turn || !m?.call) return;
  const mine = chat;
  const args = Object.fromEntries(['prompt', 'text', 'image', 'start', 'end', 'seconds', 'strength'].filter((k) => m.call[k] != null).map((k) => [k, m.call[k]]));
  const ctl = new AbortController();
  turn = { ctl, chatId: mine?.id };
  setBusy(true);
  m.result = { pending: true };
  paintBot(li, m);
  preApproved = true;
  try {
    const ctx = { li, signal: ctl.signal, summary: m.call, progress: (p) => { m.live = p; paintMediaProgress(li, p); } };
    const res = await runMedia({ tool: m.call.tool, args }, ctx);
    m.result = res.result;
  } catch (e) {
    m.result = { ...m.call, error: ctl.signal.aborted ? t('stopped') : String(e?.message || e) };
  } finally {
    preApproved = false;
    delete m.live;
    turn = null;
    setBusy(false);
    paintBot(li, m);
    if (mine) { mine.updated = Date.now(); await store.put(mine).catch(() => {}); }
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
    if ((!m.content || !m.content.trim()) && !m.context) return;
    let content = live?.get(m) ?? m.content;
    // What the user attached: the documents' text and the media ids, read with the message, never shown in its bubble.
    if (m.context) content = content && content.trim() ? `${m.context}\n\n${content}` : `${m.context}\n\n${t('attached')}`;
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
    const shown = apps ? apps.slice(0, 4) : [];
    $('mine-count').textContent = apps?.length ? String(apps.length) : '';
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
  const label = (off ? t('memBtnOff') : t('memBtnOn')) + (memDown && !off ? ' · ' + t('memDownBtn') : '');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.classList.toggle('is-down', memDown && !off);
}

// The store not answering is the memory button's state, never a card in the conversation (Kiko: a «Memoria no
// disponible ahora · Reintentar» card under «Pensando…» after an ordinary question «queda muy feo»). The button gets a
// small dot and says why; the chat asks the store again on its own, waiting longer each time (2 s up to a minute),
// and the dot goes as soon as it answers. Asked to remember or forget while it is down, the answer says so in one
// line (the memory tools' own result, runTool).
let memDown = false;
let memRetry = null, memRetryWait = 2000;
function setMemDown(down) {
  if (memDown !== down) { memDown = down; paintMemToggle(); }
  clearTimeout(memRetry); memRetry = null;
  if (!down) { memRetryWait = 2000; return; }
  memRetry = setTimeout(async () => {
    memRetry = null;
    const ok = await memory.probe().catch(() => false);
    if (!ok) memRetryWait = Math.min(memRetryWait * 2, 60000);
    setMemDown(!ok);
  }, memRetryWait);
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
      // On an iPhone or iPad tab the install screen first; «I will install it» leaves the card as it is.
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const go = await installGate();
        btn.disabled = false;
        if (!go || !box.isConnected) return;
        repaints.delete(paint); box.remove(); resolve();
      });
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
  if (e?.key) return e.key;
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
  ui.send.disabled = on || !canSend();
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
async function send(text, { typed = false, attach = [] } = {}) {
  await detected;
  if (turn || !device.ok) return;
  if (!chat) {
    chat = { id: newId(), title: titleOf(text || attach.map((a) => a.name).join(', ')), created: Date.now(), updated: Date.now(), messages: [] };
    if (pendingIncognito) chat.incognito = true;
    pendingIncognito = false;
    try { localStorage.setItem(CURRENT, chat.id); } catch { /* — */ }
  }
  // Attachments: what the card shows is kept with the message; what the model reads (a document's text, a photo's id)
  // goes in `context`, never in the bubble.
  const kept = attach.map((a) => ({ id: a.id, kind: a.kind, name: a.name, mime: a.mime, source: a.source,
    meta: { ...(a.meta || {}), ...(a.kind === 'doc' ? { pages: a.pages, chars: a.chars, truncated: a.truncated, read: a.excerpt?.length || 0 } : {}) } }));
  const context = attach.map((a) => (a.kind === 'doc' ? docContext(a, lang) : mediaContext(a, lang))).join('\n\n');
  if (attach.length) setMediaChat(attach.map((a) => a.id), chat.id).catch(() => {});
  chat.messages.push({ role: 'user', content: text, ...(typed && text.length <= TYPED_MAX ? { typed: true } : {}),
    ...(kept.length ? { attach: kept, context } : {}) });
  await save();
  ui.main.classList.remove('is-empty');
  for (const c of ui.thread.querySelectorAll('.seen-chips')) c.remove();   // what to do with a picture: only until the next message
  appendUser(text, kept);
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

// The reasoning budget of a step, from the speed the engine measured on the last turn (engine.ultimaMedida().genTokS):
// about 4 s of writing (1.5 s when the answer is read aloud), never more than the fixed caps of before (512 on the
// first step, 256 after), which are also what it gets while nothing has been measured yet (64 in a voice turn).
const THINK_SECONDS = { text: 4, voice: 1.5 };
function thinkBudget(step, voiceTurn) {
  const cap = step === 0 ? 512 : 256;
  const tps = engine?.ultimaMedida?.()?.genTokS;
  if (!(tps > 0)) return voiceTurn ? 64 : cap;
  return Math.max(0, Math.min(cap, Math.round(tps * (voiceTurn ? THINK_SECONDS.voice : THINK_SECONDS.text))));
}

// ---------- Guards: a turn never hangs in silence ----------
// Kiko, on a phone, asking for a hairdresser in Málaga: «antes de terminar se ha quedado colgado y no ha seguido».
// Each piece that can wait has its own limit, and every limit ends in something the visitor can read:
//   · a web tool call: WEB_TOOL_MS, whatever its requests do (web-research.js already ends its own at 40 s with what
//     it has); past it, the model reads that the search was cut short
//   · a model step: STALL_MS without a new token and without reading progress → the step is given up, the turn closes
//     with what it found (or says the model stopped, with «Try again»), and an engine that does not let go is reloaded
//   · the turn: after TURN_MS of visible time no new web call starts; the turn closes with what it found
//   · the context: before each step the prompt is measured against the model's real context (see fitTurn)
// Time with the tab hidden does not count: a phone pauses the page, the network and the graphics card there.
// The local tests (tests/chat-guards.mjs) shorten them through globalThis.__chatGuards; the site never sets it.
const guard = (key, gpu, cpu = gpu) => { const g = globalThis.__chatGuards?.[key]; return g != null ? g : device.cpu ? cpu : gpu; };
const WEB_TOOL_MS = () => guard('webToolMs', 45_000);
const STALL_MS = () => guard('stallMs', 120_000, 300_000);
const TURN_MS = () => guard('turnMs', 5 * 60_000, 12 * 60_000);

// The visible time since a moment, hidden spells left out.
function visibleClock() {
  const t0 = Date.now();
  let hiddenSince = document.hidden ? t0 : 0, hidden = 0;
  const on = () => {
    if (document.hidden) hiddenSince = Date.now();
    else if (hiddenSince) { hidden += Date.now() - hiddenSince; hiddenSince = 0; }
  };
  document.addEventListener('visibilitychange', on);
  return {
    ms: () => Date.now() - t0 - hidden - (hiddenSince ? Date.now() - hiddenSince : 0),
    stop: () => document.removeEventListener('visibilitychange', on),
  };
}

// A web call with its own limit: past WEB_TOOL_MS its requests are aborted and the model reads that it was cut short.
// The visitor's Stop still stops it at once (ctx.signal).
function boundedTool(call, ctx) {
  if (!String(call.tool).startsWith('web.')) return runTool(call, ctx);
  const tc = new AbortController();
  const relay = () => tc.abort();
  if (ctx.signal.aborted) tc.abort(); else ctx.signal.addEventListener('abort', relay, { once: true });
  let timer = null;
  const work = runTool(call, { ...ctx, signal: tc.signal });
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      tc.abort();
      const why = t('webSlowTool');
      const s = callSummary(call);
      resolve({ text: 'ERROR: ' + why, result: { ...(s.query != null ? { query: s.query } : {}), ...(s.url != null ? { url: s.url } : {}), error: why }, slow: true });
    }, WEB_TOOL_MS());
  });
  work.catch(() => {});   // after the limit its rejection (the abort) is nobody's business
  return Promise.race([work, late]).finally(() => { clearTimeout(timer); ctx.signal.removeEventListener('abort', relay); });
}

// ---------- The context of a step ----------
// The engine fits the history to the context by dropping the OLDEST messages: in a web turn on a phone (LFM3 Q4_0,
// 8,192 tokens, of which the reasoning reserves 4,000) the second result already pushed out the visitor's question,
// and the model went on without knowing what it was looking for. So each step is measured first, with a cautious
// count (CHARS_PER_TOKEN below what LFM3's tokenizer gives on these prompts: ~3.5 measured), and made to fit:
//   1. always: the web results of earlier turns are a digest (titles, addresses, a line each). Measured on
//      elffuss.com with the processor (4,096 tokens): a follow-up question read 3,400 tokens again before its first
//      word, most of them the pages of the previous answer, and the fifth step of a search had 119 tokens left for
//      its answer, which stopped in the middle of a word
//   2. this step answers without the reasoning block (it has the results; it only has to write)
//   3. the earlier web results of this turn become a digest; the newest stays whole
//   4. the earlier turns are left to the engine to drop (it drops the oldest first); this turn must fit on its own
// If this turn alone does not fit, the turn closes with what it found instead of overflowing.
const CHARS_PER_TOKEN = 3;
const ANSWER_ROOM = 900;             // tokens kept free for the answer when the step does not reason
function contextOf() {
  const m = model() || {};
  const real = engine?.contextoEfectivo?.() || 0;
  return real || (device.cpu ? Math.min(m.ctx || 4096, 4096) : (m.ctx || 8192));
}
const estTokens = (system, history) => Math.ceil((system.length + history.reduce((n, x) => n + String(x.content).length + 12, 0)) / CHARS_PER_TOKEN);
const isWebResult = (x) => x.role === 'user' && /^\[result web\./.test(x.content);
function digestResult(content) {
  const lines = String(content).split('\n');
  const keep = [];
  const size = () => keep.reduce((n, l) => n + l.length + 1, 0);
  for (let i = 1; i < lines.length && size() < 900; i++) {
    const l = lines[i];
    if (/^• /.test(l)) {
      keep.push(l.slice(0, 120));
      if (/^\s+https?:\/\//.test(lines[i + 1] || '')) keep.push('  ' + lines[i + 1].trim());
      if (/^\s{2}\S/.test(lines[i + 2] || '') && !/^\s+https?:\/\//.test(lines[i + 2])) keep.push('  ' + lines[i + 2].trim().slice(0, 140));
    } else if (/^\[https?:\/\/[^\]]+\]/.test(l)) {
      keep.push(l.slice(0, 200));
      const next = lines.slice(i + 1).find((x) => x.trim() && !/^§/.test(x));
      if (next) keep.push(next.trim().slice(0, 200));
    }
  }
  return `${lines[0]}\n${t('digest')}\n${keep.length ? keep.join('\n') : lines.slice(1).join(' ').slice(0, 300)}`;
}
// → { history, reason, over } for this step. `start`: where this turn begins in `history` (the visitor's message).
function fitTurn(history, system, reason, { ctx = contextOf(), budget = (r) => ctx - (r === false ? ANSWER_ROOM : (model()?.presupuesto || 4000)) } = {}) {
  let h = history, r = reason;
  let start = -1;
  for (let i = h.length - 1; i >= 0; i--) if (h[i].role === 'user' && !/^\[result /.test(h[i].content) && !/^(CONTEXTO AHORA|CONTEXT NOW)/.test(h[i].content)) { start = i; break; }
  const fits = (list = h) => estTokens(system, list) <= budget(r);
  // Always: an earlier turn's web results are digests. Its answer, with the addresses it cited, is what carries over.
  h = h.map((x, i) => (i < start && isWebResult(x) ? { ...x, content: digestResult(x.content) } : x));
  if (fits()) return { history: h, reason: r, over: false, steps: [] };
  const steps = [];
  if (r !== false) { r = false; steps.push('noReason'); if (fits()) return { history: h, reason: r, over: false, steps }; }
  let newest = -1;
  for (let i = h.length - 1; i > start; i--) if (isWebResult(h[i])) { newest = i; break; }
  h = h.map((x, i) => (i > start && i !== newest && isWebResult(x) ? { ...x, content: digestResult(x.content) } : x));
  steps.push('thisTurn');
  if (fits()) return { history: h, reason: r, over: false, steps };
  // The earlier turns are the engine's to drop; what cannot be dropped is this turn.
  steps.push('engineDrops');
  return { history: h, reason: r, over: start >= 0 && !fits(h.slice(start)), steps };
}

// An engine whose step did not let go after a stall: asked to stop; if it still holds on, it is let go and loaded
// again on the next message.
function recoverEngine(pending) {
  engine?.abort?.().catch?.(() => {});
  const settled = Promise.resolve(pending).then(() => true, () => true);
  Promise.race([settled, new Promise((r) => setTimeout(() => r(false), 5000))]).then((ok) => {
    if (ok) return;
    console.warn('[chat] the engine did not let go after a stall: unloading it');
    loading = null;
    releasing = engine?.unload?.().catch(() => {}).finally(() => { releasing = null; }) || null;
    isCached().then((c) => setModelState(c ? 'cached' : 'missing'));
  });
}

// An address in what the user wrote is read before the model answers, as the turn's first step (a web.fetch card,
// like any call): measured with LFM3, given «lee https://…» the small model searched instead of reading it, 4 times
// out of 4. Not when they ask for an app or ask to remember or forget something: the address is then data, not a
// page to read. The first address only; the model can read others.
const URL_IN = /\bhttps?:\/\/[^\s<>"«»]+/i;
function addressToRead(text) {
  // The words around the address decide, not the address: «bsky.app» is no request for an app (measured).
  const words = text.replace(new RegExp(URL_IN.source, 'gi'), ' ');
  if (mirror || ASKS_APP.test(words) || /(^|[^\p{L}])(recuerda|acu[eé]rdate|olvida|remember|forget)(?![\p{L}])/iu.test(words)) return null;
  const m = URL_IN.exec(text);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
  try { new URL(url); } catch { return null; }
  return { tool: 'web.fetch', args: { url }, forced: true };
}

// The pictures of a conversation, oldest first: the ones attached and the ones made.
function pictureIds(c) {
  const ids = [];
  for (const m of c?.messages || []) {
    for (const a of m.attach || []) if (a.kind === 'image' && a.id) ids.push(a.id);
    if (m.result?.media?.kind === 'image' && m.result.media.id) ids.push(m.result.media.id);
  }
  return ids;
}

// The pictures attached to a message, looked at once (media-tools.js describe(): Florence-2 in this browser). What
// they show goes into the message's context for the model, in the same words on every later turn; a picture that
// could not be looked at says so, and why, so the model says it rather than «I only have its id».
async function lookAtAttachments(li, mine, msg, signal) {
  const imgs = (msg?.attach || []).filter((a) => a.kind === 'image' && !a.seen);
  if (!imgs.length || mirror) return;
  const line = el('p', 'building');
  line.setAttribute('aria-live', 'polite');
  const lines = [];
  try {
    for (const a of imgs) {
      line.textContent = t('looking');
      if (!line.isConnected) li.append(line);
      mediaUi = { li, signal };
      let d;
      try { d = await untilStopped(media.describe(a.id, { signal, lang, onProgress: (p) => { line.textContent = p?.text || t('looking'); } }), signal); }
      finally { mediaUi = null; }
      const ok = d && d.reason == null && d.error == null;
      a.seen = ok ? 'ok' : (d?.reason || 'failed');
      lines.push(ok ? describedLine({ id: a.id, described: d }, lang) : t('unseen', a.id, d?.reason === 'denied' ? '' : (d?.error || '')));
    }
  } finally { line.remove(); }
  const extra = lines.filter(Boolean).join('\n') + (!String(msg.content || '').trim() && msg.attach.every((a) => a.kind === 'image') ? '\n' + t('onlyAttach') : '');
  // The «not looked at yet» note of each picture goes: it has been looked at now (or why not is said below).
  let base = msg.context || '';
  for (const a of imgs) base = base.replace(new RegExp(` \\((?:sin mirar todavía|not looked at yet)[^)]*${a.id}[^)]*\\)`), '');
  msg.context = (base ? base + '\n' : '') + extra;
  await store.put(mine).catch(() => {});
}
// What a picture sent alone shows, for an answer the model left empty: its description as the chat has it.
function seenText(msg) {
  const lines = String(msg?.context || '').split('\n').filter((l) => /^\[img-/.test(l));
  return lines.join('\n') || t('anythingElse');
}

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
  if (reason !== false && needsAppTools(userText, { open: panel.openName() }).apps) reason = false;
  // On the processor it answers straight away: a thousand tokens of reasoning are minutes before the first letter
  // there, and the engine keeps a shorter context on the processor, where the reasoning budget does not fit.
  if (device.cpu) reason = false;
  // A turn the voice reads aloud (Altavoz, Conversación) answers at once: no reasoning unless the voice settings ask for
  // it («Pensar antes de responder»), and then only about 1.5 s of it. On a phone that wrote 2 tokens a second, 512
  // tokens of reasoning were minutes of «Pensando…» with nothing said (Kiko: «se queda en thinking»).
  const voiceTurn = voice?.fastTurn?.() || null;
  if (voiceTurn && !voiceTurn.think) reason = false;
  // The media tools go in this turn's prompt only when it needs them (media-intent.js: an attachment, a media item
  // named, or a request to make one), decided once, without the model. Otherwise the prompt is the one from before
  // the media tools, byte for byte, and the engine reuses its prefix.
  const lastUser = [...mine.messages].reverse().find((m) => m.role === 'user' && m.meta !== 'result');
  // Only a picture, no words: the chat says what it sees and offers what to do with it (chips); no tool runs. Kiko,
  // on elffuss.com: a photo sent alone made the model animate it, and the card said it had failed.
  const onlyAttach = !String(lastUser?.content || '').trim() && (lastUser?.attach || []).length > 0 && lastUser.attach.every((a) => a.kind === 'image');
  // An edit of a picture the conversation has («hazla en acuarela», «ponla de noche», «cámbiale el fondo»…): which one,
  // decided here (media-intent.js editTarget). The edit then really starts from it, even when the model leaves the
  // picture out of its call (Kiko: «parece que es más por el prompt que porque usa la imagen anterior»).
  const editImage = !onlyAttach && !mirror ? editTarget(lastUser?.content || '', pictureIds(mine)) : null;
  const mediaTurn = !onlyAttach && !mirror && (!!editImage || needsMediaTools(lastUser?.content || '', {
    attachments: lastUser?.attach?.length || 0,
    hasMedia: hasMediaIn(mine.messages.map((m) => `${m.context || ''}\n${m.content || ''}`).join('\n')),
  }).media);
  // The app tools likewise (app-intent.js): asked for an app, an app open in the panel and a change or fix for it, or
  // a saved app named. Decided on the first step, when the list of saved apps is at hand.
  let appTurn = onlyAttach ? false : null;
  let attachNudged = false;
  let mt = null;                    // this turn's memory (memory-wire.js beginTurn), or null without memory
  let failed = false;
  let stepReason = reason;          // this step's: a step that has to make room answers without reasoning (fitTurn)
  const webSources = [];            // pages the web tools brought this turn, for a turn that closes on them
  const clock = visibleClock();
  try {
    // The voice mode: on a phone its models leave the tab's memory to the chat model first (voice.js).
    if (voice) { await voice.beforeTurn(); voice.turnStarted(); }
    await checked;
    // The pictures of the message are looked at before the model answers (once: the words are kept with them), so the
    // model reads what they show instead of «you cannot see it».
    await lookAtAttachments(li, mine, lastUser, ctl.signal);
    if (modelState !== 'ready') {
      if (modelState === 'missing') {
        stage = 'gate';
        // Already said yes in the voice mode's first-use question; otherwise the chat shows its own (and the
        // conversation screen steps aside so it can be seen).
        if (voiceGateOk) voiceGateOk = false;
        else { voice?.attention(); await gate(li, ctl.signal); }
      }
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
    let forced = addressToRead(userText);
    const forcedSig = forced ? forced.tool + ':' + JSON.stringify(forced.args) : '';
    let nudged = false;
    let repeatNudged = false;
    let answerAsked = false;         // the last step asked for one more web call: told to answer, one step more
    for (let step = 0; step < MAX_STEPS + (answerAsked ? 1 : 0); step++) {
      if (step > 0) {
        li = appendBot();
        msg = { role: 'assistant', content: '', thinking: '' };
        raw = ''; stepPushed = false; finished = false;
      }
      paintBot(li, msg, { thinkingLive: true });
      scrollEnd();
      if (step === 0) {
        mt = await untilStopped(memoryTurn(mine), ctl.signal);
        setMemDown(!!mt?.block.unavailable);
        memPrompt = memory.promptPieces(lang);
      }
      let call = null;
      if (forced) {
        // The address the user gave, read first (see addressToRead).
        call = forced; forced = null;
        finished = true;
      } else {
        const now = await untilStopped(liveContext(), ctl.signal);
        if (appTurn === null) appTurn = needsAppTools(userText, { open: now.open, names: (now.apps || []).map((a) => a.name) }).apps;
        const full = withTurnContext(modelHistory(mine, liveResults), contextBlock(lang, { ...now, memory: mt?.block.text || '', today: memory.today(lang), voice: !!voiceTurn }), CONTEXT_LABEL[lang]);
        const system = systemPrompt(lang, memPrompt, { web: !mirror, media: mediaTurn, apps: appTurn });
        // Measured against the model's real context before the engine sees it (fitTurn).
        const fit = fitTurn(full, system, reason);
        if (fit.steps.length) console.info('[chat] context:', fit.steps.join(' → '), fit.over ? '(does not fit: closing)' : '');
        if (fit.over && webSources.length) {
          msg.content = webClose(webSources, true);
          finished = true;
          break;
        }
        const history = fit.history;
        stepReason = fit.reason;
        // A thinking budget: the first step has to choose (answer, search, a tool); the later ones already have the
        // results in front of them. Without it a greeting thought over a thousand tokens before its first word.
        // The budget is a time, not a number of tokens: what the last turn measured it writes in a second, times 4 s
        // (1.5 s in a voice turn), within the old caps; under 32 tokens it does not reason at all (0 would be «no limit»).
        const think = stepReason === false ? 0 : thinkBudget(step, !!voiceTurn);
        engine.setSampling?.({ razonar: stepReason === false || think < 32 ? false : null, pensar: think });
        let queued = false;
        const paint = () => {
          queued = false;
          if (finished) return;              // a frame that arrives after the step ended must not repaint it as live
          const p = stepReason === false ? { thinking: '', content: raw } : split(raw);
          msg.thinking = p.thinking; msg.content = stripEcho(p.content);
          paintBot(li, msg, { writing: true, thinkingLive: !p.content });
          scrollEnd();
          voice?.answer(msg, msg.content);     // read aloud as it is written (Altavoz, Conversación)
        };
        // The memory block travels inside `history` (the CONTEXT NOW message), so the engine already counts it when it
        // fits the history to the model's context: no `reserveTokens` on top, or it would be subtracted twice.
        // The step has its own stop: the visitor's, or the watchdog's when nothing comes for STALL_MS (no token and no
        // reading progress; hidden time does not count). Then the step is not waited for any longer, whatever the
        // engine does with its stop.
        const stepCtl = new AbortController();
        const relay = () => stepCtl.abort();
        ctl.signal.addEventListener('abort', relay, { once: true });
        let beat = Date.now(), stalled = false;
        const dog = setInterval(() => {
          if (document.hidden) { beat = Date.now(); return; }
          if (Date.now() - beat > STALL_MS()) { stalled = true; stepCtl.abort(); }
        }, 1000);
        const pending = engine.chat(history, system, (tok) => {
          raw += tok;
          beat = Date.now();
          if (!queued) { queued = true; requestAnimationFrame(paint); }
        }, { signal: stepCtl.signal, onPrefill: (done, total) => { beat = Date.now(); if (!finished && !raw) paintReading(li, done, total); } });
        let result;
        try {
          result = await untilStopped(pending, stepCtl.signal);
        } catch (e) {
          if (stalled && !ctl.signal.aborted) {
            recoverEngine(pending);
            throw Object.assign(new Error('stalled'), { code: 'stalled' });
          }
          throw e;
        } finally {
          clearInterval(dog);
          ctl.signal.removeEventListener('abort', relay);
        }
        finished = true;
        const med = engine.ultimaMedida?.();
        if (med && med.genTokens > 0) {
          msg.speed = { read: med.procesados || 0, readTokS: med.prefillTokS || 0, wrote: med.genTokens, wroteTokS: med.genTokS || 0, cached: med.reusados || 0 };
        }
        const p = stepReason === false ? { thinking: '', content: raw } : split(raw);
        msg.thinking = raw.includes('</think>') ? p.thinking : (result ? '' : p.thinking);
        msg.content = stripEcho(String(result || '').trim());
        call = msg.content ? parseToolCall(msg.content) : null;
        if (call && onlyAttach) {
          // Only a picture was sent: no tool runs. Measured with LFM3: it still writes a call; told once that none is
          // needed, it answers in words. After that, the words before the call, or what the picture shows.
          const before = msg.content.split(/```|<function|<tool_call>|\{\s*"tool"/i)[0].trim();
          if (!before && !attachNudged) {
            attachNudged = true;
            mine.messages.push({ role: 'user', content: `[result ${call.tool}]\n${t('noToolHere')}`, meta: 'result' });
            li.remove();
            continue;
          }
          msg.content = before || seenText(lastUser);
          break;
        }
        if (call?.tool === 'app.create') {
          const html = String(call.args?.html || '');
          const before = msg.content.split(/```(?:html|tool)|<!doctype html|<html[\s>]/i)[0].trim();
          // A page that only frames a picture or a video of the chat is not an app (measured: «créame una imagen de
          // Málaga y París juntas» made the picture and then an app around <img src="img-…">). Never built.
          if (wrapsOnlyMedia(html)) { msg.content = before || htmlText(html) || t('anythingElse'); break; }
          // No app asked for on this turn: the page is shown as code, with a button to build it if the user wants it.
          if (!appTurn && html.trim()) {
            // A plain answer wrapped in a bare page (nothing runs in it): its text, as before.
            if (call.fromHtml && inertHtml(html)) { msg.content = before || htmlText(html); break; }
            msg.content = (before ? before + '\n\n' : '') + '```html\n' + html.trim() + '\n```';
            msg.offerApp = { name: cleanName(call.args?.name) || cleanName(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]) || '' };
            break;
          }
        }
        if (call?.fromHtml && !ASKS_APP.test(userText) && inertHtml(String(call.args?.html || ''))) {
          // What it wrote before the page, if anything, is the answer; if not, the page's own text.
          const before = msg.content.split(/```html|<!doctype html|<html[\s>]/i)[0].trim();
          msg.content = before || htmlText(String(call.args.html));
          break;
        }
        if (call?.fromHtml && explainsCode(msg.content) && !ASKS_APP.test(userText) && !(panel.openName() && ASKS_EDIT.test(userText))) {
          // An ```html block inside an explanation, and no app was asked for: it is an example to read, shown as
          // code, not a page to build (measured: «how do I read a JSON file in Python» became a broken app).
          break;
        }
        if (!call) {
          // A call the model did not finish (the budget ran out inside it) is not run and not shown as markup.
          const wt = writingTool(msg.content);
          if (wt) { msg.content = wt.before; msg.note = 'cutTool'; }
          else if (!msg.content) msg.note = 'cut';
          break;
        }
      }
      // On an edit turn the picture is the one the user means (named, else the newest): a model that leaves it out, or
      // passes an older one the user did not name (measured: «ahora de noche» after the watercolour went back to the
      // first fox), gets it put in, so edits chain.
      if (editImage && call.tool === 'image.generate' && call.args?.image !== editImage && !String(lastUser?.content || '').toLowerCase().includes(String(call.args?.image || '#').toLowerCase())) call.args = { ...(call.args || {}), image: editImage };
      const sig = call.tool + ':' + JSON.stringify(call.args || {});
      if (sig === forcedSig && !call.forced && !nudged) {
        // The model asks for the page the chat already read for it: it is told so once, and answers from it.
        nudged = true;
        mine.messages.push({ role: 'user', content: `[result ${call.tool}]\n${lang === 'es' ? 'Esa página ya está leída arriba: responde con lo que dice.' : 'That page was already read above: answer from what it says.'}`, meta: 'result' });
        li.remove();
        continue;
      }
      // The same web call again: told once that it is already above, to answer from it (measured with LFM3 on the
      // hairdresser questions: it read the same Treatwell page twice and the turn closed on a list of links instead
      // of an answer). A second repeat, or any other tool, closes with what the last one said.
      // Out of steps with web results in hand, the model still wants to search: it is told to answer now, and gets one
      // step for it (measured: a fifth search, then the turn closed on a list of links instead of an answer). If it
      // still calls a tool, the turn closes with what it found.
      if (call.tool.startsWith('web.') && webSources.length && step >= MAX_STEPS - 1) {
        if (answerAsked) { msg.content = webClose(webSources, true); break; }
        answerAsked = true;
        mine.messages.push({ role: 'user', content: `[result ${call.tool}]\n${t('answerNow')}`, meta: 'result' });
        li.remove();
        continue;
      }
      if (done.includes(sig) && call.tool.startsWith('web.') && !repeatNudged && step < MAX_STEPS - 1) {
        repeatNudged = true;
        mine.messages.push({ role: 'user', content: `[result ${call.tool}]\n${t('alreadyAbove')}`, meta: 'result' });
        li.remove();
        continue;
      }
      if (done.includes(sig)) {          // the same call again: close with what the last one said
        msg.content = lastText && !lastText.startsWith('ERROR') ? lastText : t('anythingElse');
        break;
      }
      done.push(sig);
      // Past the turn's time, no new web call: what was found so far is the answer.
      if (call.tool.startsWith('web.') && webSources.length && clock.ms() > TURN_MS()) {
        msg.content = webClose(webSources, true);
        break;
      }

      msg.call = callSummary(call);
      msg.result = null;
      voice?.answer(msg, msg.content, true);   // the words before the call, if any
      paintBot(li, msg);
      if (call.tool.startsWith('memory.')) freshCards.add(msg);
      const stepMsg = msg, stepLi = li;
      const ctx = {
        userText, summary: msg.call, memory: mt, signal: ctl.signal, li,
        progress: (p) => { stepMsg.live = p; paintMediaProgress(stepLi, p); },
        webProgress: (p) => { if (stepMsg.result) return; stepMsg.webLive = p; if (stepLi.isConnected) paintCard(stepLi, stepMsg); },
        ask: (scope, detail) => untilStopped(requirePerm(scope, detail, li, ctl.signal), ctl.signal),
        askMemory: (c) => untilStopped(askMemory(li, c, ctl.signal), ctl.signal),
      };
      const res = await untilStopped(boundedTool(call, ctx), ctl.signal);
      delete msg.webLive;
      // Any tool that is not memory taints the turn: what it returned is not the user's word, so a save after it can
      // only become a proposal.
      mt?.tool(call.tool);
      delete msg.live;
      msg.result = res.result;
      const listed = call.tool === 'memory.list';
      lastText = listed ? t('anythingElse') : (res.say ?? res.text);    // what the visitor may read if the turn closes on it
      // A web result is a page's text for the model, never an answer for the visitor: if the turn closes on it
      // (the model repeats the call, or runs out of steps), it closes with one sentence and the sources.
      if (call.tool.startsWith('web.') && !res.result?.error) {
        const found = res.result?.items?.length ? res.result.items : res.result?.url ? [{ title: res.result.title || res.result.url, url: res.result.url }] : [];
        for (const it of found) if (it?.url && !webSources.some((x) => x.url === it.url)) webSources.push({ title: String(it.title || it.url), url: it.url });
        lastText = webClose(webSources);
      }
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
      if (step === MAX_STEPS - 1 + (answerAsked ? 1 : 0)) {
        li = appendBot();
        msg = { role: 'assistant', content: lastText && !lastText.startsWith('ERROR') ? lastText : t('anythingElse'), thinking: '' };
        stepPushed = false;
      }
    }
  } catch (e) {
    if (e?.code === 'stalled' && !ctl.signal.aborted && msg && !stepPushed) {
      // The model stopped answering (STALL_MS without a word): what it wrote stays; if that was nothing, or only the
      // start of a tool call, what the web brought this turn; with nothing at all, the error and «Try again».
      const p = stepReason === false ? { thinking: '', content: raw } : split(raw);
      const wrote = stripEcho(p.content.trim());
      const words = writingTool(wrote) ? writingTool(wrote).before : wrote;
      msg.thinking = p.thinking;
      if (words || webSources.length) {
        msg.content = words || webClose(webSources, true);
        msg.note = 'stalled';
      } else {
        failed = true;
        showError(li, Object.assign(new Error(t('stalled')), { key: 'stalled' }), () => { if (!turn && chat === mine) answer(li); });
      }
    } else if (ctl.signal.aborted || e?.name === 'AbortError') {
      if (msg && !stepPushed) {
        // Keep what was written before the stop, exactly as it was on screen.
        const p = stepReason === false ? { thinking: '', content: raw } : split(raw);
        msg.thinking = p.thinking; msg.content = p.content.trim();
        if (msg.call) msg.result = msg.result || { ...msg.call, error: t('stopped') };
        delete msg.live;
        msg.stopped = true;
        if (stage === 'gate') msg.note = 'noAnswer';
      }
    } else {
      failed = true;
      // What the web brought this turn is still worth reading above the error (shown, not kept: the error has a retry).
      if (msg && !stepPushed && webSources.length && !String(msg.content || '').trim()) msg.content = webClose(webSources, true);
      showError(li, e, () => { if (!turn && chat === mine) answer(li); });
      if (friendly(e) === 'errLost') { loading = null; setModelState('cached'); }
    }
  } finally {
    clock.stop();
    finished = true;
    turn = null;
    setBusy(false);
    // A turn that ended while the tab was hidden: the count to let the model go starts now.
    if (document.hidden) watchHidden();
    if (msg && !stepPushed && onlyAttach && !msg.stopped && (msg.content || '').trim()) msg.seenChips = true;
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
      if (msg.note === 'cut' && chat === mine && stepReason !== false && !msg.stopped) {
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
    if (chat === mine && !(voice && voice.mode === 'conversation')) ui.input.focus({ preventScroll: true });
    voice?.turnEnded({ msg: msg && !msg.stopped && !failed && !msg.call ? msg : null });
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
  voice?.attention();
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
  // Both groups, tools first and then the apps, each with its «all» link; the ids of the headings are not copied.
  // In the sheet and on the no-WebGPU screen they do not fold: each group is its heading and its list.
  const groups = nav.querySelector('.app-groups').cloneNode(true);
  for (const el of groups.querySelectorAll('[id]')) el.removeAttribute('id');
  for (const d of groups.querySelectorAll('details.side-group')) {
    const h = d.querySelector('summary .side-h');
    d.querySelector('summary').remove();
    d.replaceWith(...(h ? [h] : []), ...d.childNodes);
  }
  frag.append(groups);
  return frag;
}

// The menu's folding groups (Your apps, Tools, Apps), under the chats: each one stays as the visitor left it, in
// this browser. Until then they are open while there are few chats (the room is there, and a first visit sees the
// tools) and folded from four chats on, so the chats keep the room.
const GROUPS_KEY = 'elffuss.side.groups';
const sideGroups = (() => { try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}') || {}; } catch { return {}; } })();
for (const d of document.querySelectorAll('.side .side-group')) {
  const k = d.dataset.group;
  if (typeof sideGroups[k] === 'boolean') d.open = sideGroups[k]; else d.dataset.auto = '';
  d.addEventListener('toggle', () => {
    // The browser may fold two quick changes into one event: what autoGroups() set is told by the state, not by a flag.
    if ('auto' in d.dataset && d.open === d._autoOpen) return;
    delete d.dataset.auto;
    sideGroups[k] = d.open;
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(sideGroups)); } catch { /* private mode */ }
  });
}
function autoGroups(chats) {
  for (const d of document.querySelectorAll('.side .side-group[data-auto]')) {
    const open = chats < 4;
    d._autoOpen = open;
    if (d.open !== open) d.open = open;
  }
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
  ui.send.disabled = !!turn || !canSend();
}
const canSend = () => !!ui.input.value.trim() || (pending.length > 0 && pending.every((p) => p.rec));

// ---------- Attachments (the «+» of the box) ----------
// Document, Photo or video, and on a phone Camera: each file is read here at once (attach.js) and waits as a chip
// above the box until the message goes. Nothing is uploaded.
const pending = [];                  // { file, rec?, error?, li }
function paintChips() {
  const ul = $('att-chips');
  ul.textContent = '';
  ul.hidden = !pending.length;
  if (typeof recChip !== 'undefined' && recChip.state) paintRecChip();
  for (const p of pending) {
    const li = el('li', 'att-chip' + (p.error ? ' is-error' : p.rec ? '' : ' is-reading'));
    const kind = p.rec?.kind || kindOf(p.file) || 'doc';
    li.insertAdjacentHTML('afterbegin', svg(kind === 'image' ? 'i-image' : kind === 'video' ? 'i-video' : kind === 'audio' ? 'i-audio' : 'i-doc'));
    li.append(el('span', 'att-chip-name', p.file.name || p.rec?.name || ''));
    li.append(el('span', 'att-chip-state', p.error ? p.error : p.rec ? p.rec.id : t('attReading')));
    const x = el('button', 'att-chip-x'); x.type = 'button'; x.innerHTML = svg('i-close');
    x.setAttribute('aria-label', t('attRemove', p.file.name || ''));
    x.addEventListener('click', () => { pending.splice(pending.indexOf(p), 1); paintChips(); autosize(); });
    li.append(x);
    ul.append(li);
  }
}
repaints.add(paintChips);

async function addFiles(files) {
  for (const file of files) {
    const p = { file, rec: null, error: null };
    pending.push(p);
    paintChips();
    if (!kindOf(file)) { p.error = t('attUnsupported'); paintChips(); continue; }
    attachFile(file, { base: AI_BASE, chat: chat?.id || null })
      .then((rec) => { p.rec = rec; }, (e) => { console.warn('[chat] attach', e); p.error = t('attFailed'); })
      .finally(() => { paintChips(); autosize(); });
  }
  autosize();
}

// ---------- Voice notes (the microphone of the box) ----------
// Hold it and release to send, as in WhatsApp, or tap it once to start and once more to send. The note is written down
// here by Whisper (media.transcribe, with the chat's language set: Whisper without one writes English), shown as an
// audio card, and its words go to the model as the user's message. Nothing leaves the device.
let recording = null;                // { rec, timer, at, held }
let voiceCtl = null;
const recChip = { state: null, text: '' };   // 'rec' | 'busy' | 'error'
function paintRecChip() {
  const ul = $('att-chips');
  ul.querySelector('.rec-chip')?.remove();
  if (!recChip.state) { ul.hidden = !pending.length && !ul.querySelector('.rec-li'); return; }
  const li = el('li', 'att-chip rec-chip' + (recChip.state === 'rec' ? ' is-rec' : recChip.state === 'error' ? ' is-error' : ' is-reading'));
  li.insertAdjacentHTML('afterbegin', svg('i-mic'));
  const txt = el('span', 'att-chip-name', recChip.text);
  txt.setAttribute('aria-live', 'polite');
  li.append(txt);
  if (recChip.state !== 'busy') {
    const x = el('button', 'att-chip-x'); x.type = 'button'; x.innerHTML = svg('i-close');
    x.setAttribute('aria-label', t('recCancel'));
    x.addEventListener('click', () => { if (recording) cancelRecording(); recChip.state = null; paintRecChip(); });
    li.append(x);
  }
  ul.prepend(li);
  ul.hidden = false;
}
function setMic(on) { const b = $('mic-btn'); b.classList.toggle('is-rec', on); b.setAttribute('aria-pressed', String(on)); b.title = on ? t('recHint') : b.getAttribute(`data-title-${lang}`); }
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// While it records: the live waveform panel (attach.js recorderPanel) in place of the chip, with its own «Cancelar» and
// «Enviar»; Kiko: «se tiene que ver la onda que está capturando».
function cancelRecording() {
  if (!recording) return;
  recording.rec.cancel(); clearInterval(recording.timer); recording.panel?.destroy(); recording = null;
  setMic(false); recChip.state = null; paintRecChip();
  $('att-chips').querySelector('.rec-li')?.remove();
}
async function beginRecording() {
  try {
    const rec = await startRecording();
    recording = { rec, at: performance.now(), held: true, timer: 0 };
    const panel = recorderPanel(rec, { lang, onCancel: () => cancelRecording(), onSend: () => finishRecording() });
    recording.panel = panel;
    const ul = $('att-chips');
    const li = el('li', 'rec-li');
    li.append(panel.el);
    ul.prepend(li);
    ul.hidden = false;
    recChip.state = null;
    setMic(true);
  } catch (e) {
    console.warn('[chat] microphone', e);
    recChip.state = 'error'; recChip.text = t('micDenied'); paintRecChip();
  }
}

async function finishRecording() {
  const r = recording;
  if (!r) return;
  recording = null;
  clearInterval(r.timer);
  r.panel?.destroy();
  $('att-chips').querySelector('.rec-li')?.remove();
  setMic(false);
  const { blob, seconds, peaks } = await r.rec.stop();
  if (seconds < 0.6 || !blob.size) { recChip.state = null; paintRecChip(); return; }
  recChip.state = 'busy'; recChip.text = t('transcribing'); paintRecChip();
  const ctl = new AbortController();
  voiceCtl = ctl;
  // Where the download question goes the first time: its own item in the thread, gone once answered.
  const holder = el('li', 'msg msg-note');
  ui.thread.append(holder);
  ui.main.classList.remove('is-empty');
  mediaUi = { li: holder, signal: ctl.signal };
  try {
    const samples = await toMono16k(blob);
    const out = await media.transcribe(samples, { signal: ctl.signal, lang, language: lang, onProgress: (p) => { recChip.text = `${t('transcribing')} ${p.text && p.text !== t('transcribing') ? '· ' + p.text : ''}`.trim(); paintRecChip(); } });
    if (out.text) {
      const rec = await keepVoiceNote(blob, seconds, { chat: chat?.id || null, transcript: out.text, peaks });
      recChip.state = null; paintRecChip();
      send(out.text, { attach: [rec] });
    } else if (out.reason === 'denied') { recChip.state = null; paintRecChip(); }
    else { recChip.state = 'error'; recChip.text = out.error || t('voiceEmpty'); paintRecChip(); }
  } catch (e) {
    if (e?.name !== 'AbortError') { console.warn('[chat] voice note', e); recChip.state = 'error'; recChip.text = t('voiceEmpty'); paintRecChip(); }
    else { recChip.state = null; paintRecChip(); }
  } finally {
    holder.remove();
    mediaUi = null; voiceCtl = null;
    if (chat === null || !chat.messages.length) ui.main.classList.toggle('is-empty', !ui.thread.children.length);
  }
}

function wireMic() {
  const mic = $('mic-btn');
  if (!mic || mirror || !canRecord()) return;
  mic.hidden = false;
  // Pointer: press starts; a release after a hold sends; a quick tap leaves it recording until the next tap.
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || voiceCtl) return;
    if (recording) { finishRecording(); return; }
    beginRecording();
  });
  mic.addEventListener('pointerup', () => {
    if (!recording?.held) return;
    recording.held = false;
    if (performance.now() - recording.at >= 400) finishRecording();
  });
  // Keyboard (Enter or Space): a click with no pointer toggles.
  mic.addEventListener('click', (e) => {
    if (e.detail !== 0 || voiceCtl) return;
    if (recording) finishRecording(); else beginRecording().then(() => { if (recording) recording.held = false; });
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && recording) cancelRecording(); });
  // Holding the microphone on a phone: sliding the finger left cancels, as in WhatsApp.
  let startX = null;
  mic.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  addEventListener('pointermove', (e) => { if (recording?.held && startX != null && e.clientX - startX < -80) { startX = null; cancelRecording(); } });
  addEventListener('pointerup', () => { startX = null; });
}

function wireAttach() {
  const btn = $('att-btn'), menu = $('att-menu');
  if (!btn) return;
  const docIn = $('att-doc'), mediaIn = $('att-media'), camIn = $('att-camera');
  docIn.accept = DOC_ACCEPT;
  // The camera entry only where there is one to point: a phone or a tablet.
  if (matchMedia('(pointer: coarse)').matches) menu.querySelector('[data-att="camera"]').hidden = false;
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button:not([hidden])')?.focus();
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.att-wrap')) close(); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
  for (const b of menu.querySelectorAll('[data-att]')) {
    b.addEventListener('click', () => {
      close();
      ({ doc: docIn, media: mediaIn, camera: camIn })[b.dataset.att].click();
    });
  }
  for (const input of [docIn, mediaIn, camIn]) {
    input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; ui.input.focus(); });
  }
  // A picture pasted or dropped on the box is an attachment too.
  ui.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  ui.form.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  ui.form.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
}

// Text that arrives in the box by pasting or dropping is not typed: the message it ends up in cannot ground a memory.
let pasted = false;
function wire() {
  ui.input.addEventListener('input', () => { if (!ui.input.value) pasted = false; autosize(); voice?.userTyped(); });
  ui.input.addEventListener('paste', () => { pasted = true; });
  ui.input.addEventListener('drop', () => { pasted = true; });
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ui.form.requestSubmit(); }
  });
  // ↑ and ↓ go through the messages sent, as in a terminal (input-history.js). A message brought back counts as pasted,
  // not typed: only what is typed now can ground a memory.
  const sentHistory = inputHistory(ui.input, {
    chats: () => store.list(), current: () => chat,
    skip: () => !!recording || voice?.mode === 'conversation',
    onSet: () => { pasted = !!ui.input.value; autosize(); },
  });
  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ui.input.value.trim();
    if (!canSend() || turn) return;
    const typed = !pasted;
    const attach = pending.filter((p) => p.rec).map((p) => p.rec);
    pending.length = 0;
    paintChips();
    ui.input.value = '';
    pasted = false;
    autosize();
    sentHistory.sent(text);
    send(text, { typed, attach });
  });
  ui.stop.addEventListener('click', () => { voice?.stopPressed(); stopTurn(); });
  wireAttach();
  wireMic();
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
  // The memory's store is asked once as soon as the page is up, before a model starts loading: its frame connects
  // while the page is idle, instead of on the first turn, when the model's loading keeps the page busy.
  memory.load().then((m) => {
    if (!m) return;
    paintMemToggle(); paintMine(); repaintMemCards();
    if (!mirror) memory.probe().then((ok) => setMemDown(!ok), () => setMemDown(true));
  });
  // Claw may have changed the apps or the memory in another tab: look again when this one comes back.
  addEventListener('focus', () => paintMine());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paintMine(); });
  let last = null;
  try { last = localStorage.getItem(CURRENT); } catch { /* — */ }
  if (last) await within(() => openChat(last), BOOT_MS.chat, null, 'opening the last chat'); else paintList();

  try {
    Object.assign(device, await within(pickDevice, BOOT_MS.device, () => (cpuCan() && MODELS['lfm3-1.7b-q4']
      ? { ok: true, id: 'lfm3-1.7b-q4', cpu: true, why: 'timeout' } : { ok: false, why: 'whyNoAdapter' }), 'choosing the device'));
    // What this tab runs, for the Web Inspector of a phone: the model, processor or graphics card, and why.
    globalThis.__chatDevice = { ...device, forcedCpu: FORCE_CPU, askedCpu: CPU_ASKED, touch: TOUCH_DEVICE };
    markDetected();
    if (!device.ok) { showNoGpu(device.why); return; }
    if (await within(isolateForCpu, BOOT_MS.isolate, false, 'isolating the page')) return;   // the page reloads isolated
    setModelState('checking');
    // Not known in time: «missing» (the load still finds a stored model and does not download it), corrected when the
    // store answers.
    const asking = isCached();
    const cached = await within(asking, BOOT_MS.cached, null, 'asking whether the model is stored');
    setModelState(cached ? 'cached' : 'missing');
    if (cached === null) asking.then((c) => { if (c && modelState === 'missing') setModelState('cached'); }, () => {});
  } finally {
    // Whatever happened above, a turn never waits forever for the start, and the voice control appears.
    markDetected(); markChecked();
    if (device.ok) startVoice();
  }
}

// The start failed outright: said in the page, not only in the console.
function showBootError(e) {
  console.error('[chat] boot failed', e);
  try {
    ui.fine.hidden = false;
    ui.fine.textContent = t('bootFailed', String(e?.message || e).slice(0, 160));
  } catch { /* the page itself is not there */ }
}

// The voice mode: its control in the top bar, the reading aloud and the conversation screen (voice.js). What it hears
// is sent as the user's own words; it reads the answer as the turn writes it.
function startVoice() {
  if (voice || mirror) return;
  try {
    voice = createVoice({
      kit: media.voiceKit, lang: () => lang, live,
      send: async (text) => { if (turn) await stopTurn(); send(text, { typed: true }); },
      stopTurn, turnRunning: () => !!turn, unloadLlm,
      chatModel: () => ({ missing: modelState === 'missing', bytes: model()?.bytes || 0 }),
      approveChatModel: () => { voiceGateOk = true; },
      beforeDownload: installGate,
      chip: $('voice-btn'), stage: document.querySelector('.stage'), input: ui.input,
    });
  } catch (e) { console.warn('[chat] voice mode did not start', e); }
}

boot().catch(showBootError);
