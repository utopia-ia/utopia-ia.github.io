// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The chat's voice mode. A control in the top bar, next to «Memoria», picks one of three modes:
//
//   Texto          as always
//   Altavoz        every answer is read aloud as it is written, sentence by sentence (voice-core.js createChunker),
//                  with the chat's voices: Spanish with Elffuss's own voice (MOSS-TTS-Nano on the Elffuss Engine, WebGPU
//                  or processor), English with Kokoro; it stops when the user types or presses stop
//   Conversación   hands free: an orb that follows the user's voice (voice-orb.js) while they speak, the end of what
//                  they said found by silence (voice-core.js createEndpointer), Whisper writes it down here (the
//                  language told first, the page's language as a prior: Whisper without one writes English), it is
//                  sent, and a second orb follows the answer's voice. Talking over the answer, or a tap, interrupts it.
//
// Everything runs in this browser: the microphone is open only while the conversation is on screen, and neither the
// audio nor the words leave the device. The speech models come through the SDK copy and the model store, pinned by
// revision and sha256 (vendor/elffuss-ai/registry, vendor/elffuss-asr/registry.json), like the media tools.
//
// Memory: on a computer the chat model, Whisper and the voice stay loaded together and the answer is read while it is
// written. On a phone a tab has about 2 GB and the chat model alone takes most of it, so they take turns: the voice
// models go while the chat model answers, and the chat model goes while the answer is read and the user speaks.

import { createEndpointer, resampleTo16k, createChunker, speakable, textLang, isHallucination, reduce, initialState, parseWav, MODES } from './voice-core.js';
import { createOrbs } from './voice-orb.js';
import { formatBytes } from './media-tools.js';

const KEY = 'elffuss.voice';
const SPEED = { min: 0.8, max: 1.4, step: 0.05 };
const PAUSE = { min: 400, max: 2000, step: 100 };
const DEFAULTS = { mode: 'text', voiceEs: 'es_elffuss', voiceEn: 'af_heart', speed: 1, pauseMs: 800, autoSend: true, think: false, seen: false };
// The voices when the SDK copy does not list them (its audio module gives VOICES).
const FALLBACK_VOICES = [
  { id: 'es_elffuss', name: 'Elffuss', lang: 'es', gender: 'f', model: 'moss' }, { id: 'ef_dora', name: 'Dora', lang: 'es', gender: 'f', model: 'kokoro' },
  { id: 'em_alex', name: 'Alex', lang: 'es', gender: 'm', model: 'kokoro' }, { id: 'af_heart', name: 'Heart', lang: 'en', gender: 'f', model: 'kokoro' },
  { id: 'af_bella', name: 'Bella', lang: 'en', gender: 'f', model: 'kokoro' }, { id: 'am_michael', name: 'Michael', lang: 'en', gender: 'm', model: 'kokoro' },
];

const WORDS = {
  es: {
    chip: 'Voz', modeTitle: 'Modo de voz',
    modes: { text: ['Texto', 'Sin voz, como siempre'], speaker: ['Altavoz', 'Lee en voz alta cada respuesta'], conversation: ['Conversación', 'Hablas y te contesta, sin manos'] },
    more: 'Más opciones',
    settings: 'Ajustes', voiceEs: 'Voz en español', voiceEn: 'Voz en inglés', speed: 'Velocidad', pause: 'Pausa para terminar',
    pauseHint: 'Silencio que hace falta para dar por acabada tu frase', autoSend: 'Enviar al terminar de hablar', think: 'Pensar antes de responder', thinkHint: 'Más lento: en un móvil, muchos segundos antes de la primera palabra', filler: 'Un momento…',
    onDevice: 'Todo ocurre en este dispositivo: ni tu voz ni el texto salen del navegador.',
    voiceName: (v) => (v.model === 'moss' ? `${v.name}, la voz de Elffuss` : `${v.name} · ${v.gender === 'm' ? 'masculina' : 'femenina'}`),
    phases: {
      loading: 'Preparando la voz…', listening: 'Te escucho', hearing: 'Te oigo…', transcribing: 'Escribiendo lo que has dicho…',
      review: '¿Lo envío?', thinking: 'Pensando…', speaking: 'Elffuss responde', paused: 'En pausa', error: 'No ha podido empezar',
    },
    hints: {
      listening: 'Habla cuando quieras', hearing: 'Toca el círculo para enviarlo', thinking: 'Toca para interrumpir', speaking: '',
      paused: 'Toca el círculo para seguir', loading: '', transcribing: '', review: '', error: 'Toca el círculo para reintentar',
    },
    orbLabel: { listening: 'Pausar la escucha', hearing: 'Enviar lo que he dicho', thinking: 'Interrumpir', speaking: 'Interrumpir', paused: 'Seguir escuchando', error: 'Reintentar', loading: 'Preparando', transcribing: 'Escribiendo', review: 'Esperando' },
    send: 'Enviar', discard: 'Descartar', pauseBtn: 'Pausar', resumeBtn: 'Seguir', exit: 'Volver al texto', showChat: 'Ver el chat', backTo: 'Volver a la conversación',
    attention: 'El chat necesita tu respuesta',
    consentTitle: { speaker: 'Leer las respuestas en voz alta', conversation: 'Hablar con Elffuss' },
    consentBody: {
      speaker: 'Las respuestas se leen en voz alta aquí mismo, en este dispositivo. Nada sale de este navegador.',
      conversation: 'Todo pasa en este dispositivo: tu voz se convierte en texto aquí y la respuesta se lee aquí. Ni el audio ni el texto salen de este navegador.',
    },
    consentMic: 'El micrófono solo está abierto mientras ves esta pantalla. Puedes hablar encima de la respuesta para interrumpirla.',
    consentSize: (s) => `La primera vez se descargan los modelos de voz (${s}). Después quedan guardados en este navegador.`,
    consentChat: (s) => `También el modelo del chat, que aún no está: ${s}.`,
    consentGo: (s) => (s ? `Descargar ${s} y empezar` : 'Empezar'), consentNo: 'Ahora no',
    what: (s) => `Lo que se descarga · ${s}`, stored: 'ya está aquí',
    items: { chat: 'El modelo del chat', asr: 'Whisper, que escribe lo que dices', vad: 'El detector de voz (Silero)', es: 'La voz en español', en: 'La voz en inglés' },
    getting: (a, b, p) => `Descargando ${a} de ${b} · ${p} %`, gotAll: 'Todo descargado. Preparando…', later: 'Seguir en segundo plano',
    failedGet: (a, b) => `Se ha cortado con ${a} de ${b} bajados. Lo bajado se guarda: al reintentar sigue desde ahí.`, retry: 'Reintentar', cancel: 'Ahora no',
    progress: (p) => `Preparando la voz… ${p}%`,
    errors: {
      'mic-denied': 'Sin permiso para el micrófono. Dale permiso en el candado de la barra de direcciones y toca el círculo.',
      'mic-missing': 'Este dispositivo no tiene micrófono, o no está disponible.', 'no-audio': 'Este navegador no puede grabar audio aquí.',
      'device-unsupported': 'Este dispositivo no puede ejecutar los modelos de voz.', denied: 'No se ha descargado nada.',
      failed: 'Los modelos de voz no han cargado. Toca el círculo para reintentar.',
    },
    close: 'Cerrar',
  },
  en: {
    chip: 'Voice', modeTitle: 'Voice mode',
    modes: { text: ['Text', 'No voice, as usual'], speaker: ['Speaker', 'Reads every answer aloud'], conversation: ['Conversation', 'You talk, it answers, hands free'] },
    more: 'More options',
    settings: 'Settings', voiceEs: 'Spanish voice', voiceEn: 'English voice', speed: 'Speed', pause: 'Pause to finish',
    pauseHint: 'How much silence ends what you are saying', autoSend: 'Send when you stop talking', think: 'Think before answering', thinkHint: 'Slower: on a phone, many seconds before the first word', filler: 'One moment…',
    onDevice: 'Everything happens on this device: neither your voice nor the text leaves the browser.',
    voiceName: (v) => (v.model === 'moss' ? `${v.name}, Elffuss's own voice` : `${v.name} · ${v.gender === 'm' ? 'male' : 'female'}`),
    phases: {
      loading: 'Getting the voice ready…', listening: 'Listening', hearing: 'Hearing you…', transcribing: 'Writing down what you said…',
      review: 'Send it?', thinking: 'Thinking…', speaking: 'Elffuss is answering', paused: 'Paused', error: 'Could not start',
    },
    hints: {
      listening: 'Talk whenever you like', hearing: 'Tap the circle to send it', thinking: 'Tap to interrupt', speaking: '',
      paused: 'Tap the circle to go on', loading: '', transcribing: '', review: '', error: 'Tap the circle to try again',
    },
    orbLabel: { listening: 'Pause listening', hearing: 'Send what I said', thinking: 'Interrupt', speaking: 'Interrupt', paused: 'Listen again', error: 'Try again', loading: 'Getting ready', transcribing: 'Writing', review: 'Waiting' },
    send: 'Send', discard: 'Discard', pauseBtn: 'Pause', resumeBtn: 'Go on', exit: 'Back to text', showChat: 'See the chat', backTo: 'Back to the conversation',
    attention: 'The chat needs your answer',
    consentTitle: { speaker: 'Read the answers aloud', conversation: 'Talk with Elffuss' },
    consentBody: {
      speaker: 'Answers are read aloud right here, on this device. Nothing leaves this browser.',
      conversation: 'Everything happens on this device: your voice becomes text here and the answer is read here. Neither the audio nor the text leaves this browser.',
    },
    consentMic: 'The microphone is open only while this screen is on. You can talk over the answer to interrupt it.',
    consentSize: (s) => `The first time, the voice models are downloaded (${s}). After that they stay in this browser.`,
    consentChat: (s) => `And the chat model, which is not here yet: ${s}.`,
    consentGo: (s) => (s ? `Download ${s} and start` : 'Start'), consentNo: 'Not now',
    what: (s) => `What is downloaded · ${s}`, stored: 'already here',
    items: { chat: 'The chat model', asr: 'Whisper, which writes down what you say', vad: 'The voice detector (Silero)', es: 'The Spanish voice', en: 'The English voice' },
    getting: (a, b, p) => `Downloading ${a} of ${b} · ${p}%`, gotAll: 'All downloaded. Getting ready…', later: 'Continue in the background',
    failedGet: (a, b) => `It was cut with ${a} of ${b} downloaded. What arrived is kept: trying again goes on from there.`, retry: 'Try again', cancel: 'Not now',
    progress: (p) => `Getting the voice ready… ${p}%`,
    errors: {
      'mic-denied': 'No permission for the microphone. Allow it from the padlock in the address bar and tap the circle.',
      'mic-missing': 'This device has no microphone, or it is not available.', 'no-audio': 'This browser cannot record audio here.',
      'device-unsupported': 'This device cannot run the voice models.', denied: 'Nothing was downloaded.',
      failed: 'The voice models did not load. Tap the circle to try again.',
    },
    close: 'Close',
  },
};

const ICON = { text: 'i-v-text', speaker: 'i-v-speaker', conversation: 'i-v-talk' };
const coarse = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches;
const reduceMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const abortErr = () => Object.assign(new Error('stopped'), { name: 'AbortError' });

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

/**
 * @param {{ kit: { env: () => Promise<{store, runtime}>, module: (m: string) => Promise<any>, asr: () => Promise<any> },
 *   lang: () => 'es'|'en', live?: (fn: () => void) => void,
 *   send: (text: string) => void, stopTurn: () => Promise<void>, turnRunning: () => boolean,
 *   unloadLlm: () => Promise<void>, chatModel: () => ({ missing: boolean, bytes: number, fetch?: (onProgress) => Promise<void> }),
 *   beforeDownload?: () => Promise<boolean>,
 *   chip: HTMLElement, stage: HTMLElement, input?: HTMLElement }} hooks
 */
export function createVoice(hooks) {
  const settings = loadSettings();
  // A conversation is never resumed by a reload (it would open the microphone by itself); the speaker is.
  if (settings.mode === 'conversation') settings.mode = 'text';
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ } };
  const w = () => WORDS[hooks.lang() === 'es' ? 'es' : 'en'];
  const policy = coarse() ? 'turns' : 'together';
  let state = { ...initialState };
  const debug = (globalThis.__voice = { state, events: [], times: [], spoken: [], partials: [], policy });
  // Why the voice did not load, in the words of the part that failed (the store, Whisper…): shown under «did not load»
  // so the reason can be read on the phone, not only in a console nobody sees there.
  let lastError = '';
  const noteError = (err) => { lastError = String(err?.message || err || '').replace(/\s+/g, ' ').trim().slice(0, 180); debug.lastError = lastError; };
  const log = (ev) => { debug.events.push(ev); debug.times.push(Math.round(performance.now())); if (debug.events.length > 300) { debug.events.shift(); debug.times.shift(); } };

  // ---------- Models ----------
  let voices = FALLBACK_VOICES;
  let audioMod = null, speech = null, speechLangs = new Set();
  let asr = null, asrLoading = null;
  let loadPct = null;
  const onProgress = (p) => {
    if (p?.status === 'downloading' && p.total) { loadPct = Math.round((100 * p.loaded) / p.total); render(); }
  };
  async function audio() {
    if (!audioMod) {
      audioMod = await hooks.kit.module('audio');
      if (Array.isArray(audioMod.VOICES) && audioMod.VOICES.length) voices = audioMod.VOICES.map((v) => ({ id: v.id, name: v.name, lang: v.lang, gender: v.gender, model: v.model }));
      paintPop();
    }
    return audioMod;
  }
  const voiceFor = (lang) => (lang === 'en' ? settings.voiceEn : settings.voiceEs);
  const isKokoro = (id) => (voices.find((v) => v.id === id)?.model || (id.startsWith('es_') ? 'moss' : 'kokoro')) === 'kokoro';
  async function speechTask() {
    const mod = await audio();
    if (!speech) { const e = await hooks.kit.env(); speech = new mod.Speech({ store: e.store, runtime: e.runtime, onProgress }); speechLangs = new Set(); }
    return speech;
  }
  async function loadSpeech(lang) {
    const t = await speechTask();
    if (!speechLangs.has(lang)) { await t.load?.({ lang, voice: voiceFor(lang) }); speechLangs.add(lang); }
    return t;
  }
  async function loadAsr() {
    if (asr) return asr;
    if (asrLoading) return asrLoading;
    asrLoading = (async () => {
      const mod = await hooks.kit.asr();
      const e = await hooks.kit.env();
      const registry = await mod.registry();
      let model = mod.pickModel ? await mod.pickModel() : undefined;
      const make = (m) => new mod.SpeechToText({ store: e.store, runtime: e.runtime, registry, ...(m ? { model: m } : {}), onProgress });
      let task = make(model);
      try { await task.load?.(); } catch (err) {
        // small did not load (a store that does not have it, a graphics card that cannot): base, as the voice notes.
        if (!model || model === mod.MODELS?.base) throw err;
        console.warn('[voice] Whisper small did not load, base instead', err);
        try { await task.dispose(); } catch { /* releasing */ }
        model = mod.MODELS?.base; task = make(model); await task.load?.();
      }
      asr = { task, model, partials: policy === 'together' && model !== mod.MODELS?.base };
      debug.asrModel = model || 'default';
      return asr;
    })().finally(() => { asrLoading = null; });
    return asrLoading;
  }
  async function disposeSpeech() {
    const s = speech; speech = null; speechLangs = new Set();
    await Promise.resolve(s?.dispose?.()).catch(() => {});
  }
  async function disposeModels() {
    const a = asr, s = speech, v = vad;
    asr = null; speech = null; speechLangs = new Set(); vad = null; vadLoading = null; debug.vad = 'off';
    await Promise.all([a?.task.dispose?.(), s?.dispose?.(), v?.dispose?.()].map((p) => Promise.resolve(p).catch(() => {})));
  }

  // The neural voice activity (Silero VAD v5, 2.2 MB, processor): what tells the end of a sentence in a noisy room.
  // Without it (it did not load, or this copy of the page has none) the endpointer goes on with loudness alone.
  let vad = null, vadLoading = null;
  function loadVad() {
    if (vad || vadLoading) return vadLoading || Promise.resolve(vad);
    debug.vad = 'loading';
    vadLoading = (async () => {
      try {
        const mod = await hooks.kit.asr();
        if (!mod.VoiceActivity) { debug.vad = 'energy'; return null; }
        const e = await hooks.kit.env();
        const t = new mod.VoiceActivity({ store: e.store, runtime: e.runtime, registry: await mod.registry() });
        await t.load?.();
        vad = t; debug.vad = 'silero';
        return t;
      } catch (err) {
        console.warn('[voice] the voice activity model did not load: loudness only', err);
        debug.vad = 'energy'; debug.vadError = String(err?.message || err);
        return null;
      } finally { vadLoading = null; }
    })();
    return vadLoading;
  }

  // ---------- One download for everything a mode needs ----------
  // Kiko: «tiene que bajar todos los modelos que necesite del tirón, no ir uno a uno». Choosing a mode works out every
  // file it will use here (the chat model if missing, Whisper, the voice detector, the voice of the page's language
  // and of the other one when the browser speaks it too), asks once with the total, downloads them together (three
  // at a time, through the model store, which keeps what arrived: a retry goes on from there), and only then loads
  // the models and listens. A phone downloads everything too, and still loads in turns (the tab's memory).
  const speakLangs = () => {
    const ui = hooks.lang() === 'es' ? 'es' : 'en', other = ui === 'es' ? 'en' : 'es';
    const known = (navigator.languages || [navigator.language || '']).some((l) => String(l).toLowerCase().startsWith(other));
    return known ? [ui, other] : [ui];
  };
  async function plan(mode) {
    const e = await hooks.kit.env();
    const has = async (f) => { try { return await e.store.has(f.url, f.size); } catch { return false; } };
    const item = async (key, files) => {
      const list = await Promise.all(files.map(async (f) => ({ ...f, has: await has(f) })));
      return { key, files: list, bytes: list.reduce((n, f) => n + f.size, 0), missing: list.reduce((n, f) => n + (f.has ? 0 : f.size), 0) };
    };
    const items = [];
    const c = hooks.chatModel?.() || { missing: false };
    if (c.missing && c.fetch) items.push({ key: 'chat', bytes: c.bytes, missing: c.bytes, fetch: c.fetch, files: [] });
    if (mode === 'conversation') {
      const am = await hooks.kit.asr();
      const model = am.pickModel ? await am.pickModel() : undefined;
      if (am.filesFor) items.push(await item('asr', await am.filesFor({ model })));
      if (am.VoiceActivity?.files) items.push(await item('vad', am.VoiceActivity.files({ registry: await am.registry() })));
    }
    try {
      const core = await hooks.kit.core();
      const reg = await core.loadRegistry();
      const probe = await core.probeWebGPU();
      for (const l of speakLangs()) {
        const v = voices.find((x) => x.id === voiceFor(l));
        const id = v?.model === 'kokoro' || (!v && l === 'en') ? 'text-to-speech/kokoro-82m' : 'text-to-speech/moss-tts-nano';
        let files;
        try { files = core.eagerFiles(core.getModel(reg, id), core.chooseVariant(core.getModel(reg, id), 'auto', probe).variant); }
        catch { if (l === hooks.lang()) return { error: 'device-unsupported' }; continue; }
        items.push(await item(l, files.map((f) => ({ url: f.url, size: f.size }))));
      }
    } catch (err) { console.warn('[voice] which voice files', err); }
    return { items, missing: items.reduce((n, it) => n + it.missing, 0) };
  }
  /** Download what `p` lacks, `lanes` at a time; onProgress({ loaded, total, items }). Throws when a file fails. */
  async function batch(p, onProgress = () => {}, lanes = 3) {
    const e = await hooks.kit.env();
    const total = p.missing || 1;
    const got = new Map();                  // job → bytes so far
    const jobs = [];
    for (const it of p.items) {
      if (it.fetch) jobs.push({ it, size: it.missing, run: (on) => it.fetch(on) });
      for (const f of it.files) if (!f.has) jobs.push({ it, size: f.size, f, run: (on) => e.store.get(f.url, { bytes: f.size, onProgress: on }) });
    }
    const tell = () => {
      const loaded = [...got.values()].reduce((n, v) => n + v, 0);
      const items = p.items.map((it) => ({ key: it.key, missing: it.missing, loaded: jobs.filter((j) => j.it === it).reduce((n, j) => n + (got.get(j) || 0), 0) }));
      onProgress({ loaded: Math.min(loaded, total), total, items });
    };
    debug.batch = { files: jobs.length, asked: [] };
    let next = 0, failed = null;
    const lane = async () => {
      while (next < jobs.length && !failed) {
        const j = jobs[next++];
        debug.batch.asked.push(j.f?.url || j.it.key);
        await j.run((x) => {
          // The store says { loaded, total }; the chat model's loader may say a line with a percentage.
          const v = typeof x === 'number' ? x * j.size : x && typeof x === 'object' && Number.isFinite(x.loaded) ? x.loaded : typeof x === 'string' && /(\d+(?:[.,]\d+)?)\s*%/.test(x) ? (parseFloat(/(\d+(?:[.,]\d+)?)\s*%/.exec(x)[1].replace(',', '.')) / 100) * j.size : null;
          if (v != null) { got.set(j, Math.min(j.size, v)); tell(); }
        });
        got.set(j, j.size); if (j.f) j.f.has = true; else j.it.missing = 0;
        tell();
      }
    };
    tell();
    // A failure stops the lanes from taking new files; the ones under way finish (what arrived is kept), and only
    // then the failure is told: a retry then asks for exactly what is missing, never for a file twice at once.
    const runs = await Promise.allSettled(Array.from({ length: Math.min(lanes, jobs.length) }, () => lane().catch((err) => { failed ||= err; throw err; })));
    if (failed || runs.some((r) => r.status === 'rejected')) throw failed || runs.find((r) => r.status === 'rejected').reason;
    for (const it of p.items) if (!it.fetch) it.missing = it.files.reduce((n, f) => n + (f.has ? 0 : f.size), 0);
    p.missing = p.items.reduce((n, it) => n + it.missing, 0);
  }

  // ---------- Sound and the microphone on phones ----------
  // Apple's mobile browser starts sound only from a tap: an AudioContext made or resumed outside one stays suspended
  // and its resume() never settles (measured on an iPhone, 9-nov), and the microphone asked for after the tap's awaits
  // waited with no question in sight («Preparando la voz…» for ever). So the tap that chooses a voice mode wakes the
  // one context the voice uses (never closed) and, for a conversation, asks for the microphone right there; what
  // runs later takes them. Any later tap wakes the context again (the phone suspends it when its sound changes).
  const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
  const micError = (err) => {
    const code = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'mic-denied' : err?.name === 'NotFoundError' ? 'mic-missing' : 'no-audio';
    return Object.assign(new Error(code), { code });
  };
  let audioCtx = null, micAsk = null;
  function audioContext() {
    if (!audioCtx || audioCtx.state === 'closed') { const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; audioCtx = new Ctx(); }
    return audioCtx;
  }
  /** From a tap: the context runs, and the players may play. */
  function wake() {
    try { const ac = audioContext(); if (ac.state !== 'running') ac.resume().catch(() => {}); } catch { /* no Web Audio */ }
    unlockAudio();
  }
  /** From a tap: the microphone's question, now (its answer is taken by askMic() or openMic()). */
  function askMicNow() {
    if (mic || micAsk || !navigator.mediaDevices?.getUserMedia) return;
    micAsk = navigator.mediaDevices.getUserMedia(MIC);
    micAsk.catch(() => {});
  }
  function takeMic() { const a = micAsk; micAsk = null; return a || navigator.mediaDevices.getUserMedia(MIC); }
  function dropMic() { const a = micAsk; micAsk = null; a?.then((s) => s.getTracks().forEach((t) => t.stop()), () => {}); }
  for (const type of ['touchend', 'click']) document.addEventListener(type, () => { if (state.mode !== 'text' && audioCtx && audioCtx.state !== 'running') wake(); }, true);

  // ---------- The microphone ----------
  let mic = null;
  const ep = createEndpointer({ silenceMs: settings.pauseMs });
  let partialTimer = 0, partialBusy = false, lastLang = null;
  async function openMic() {
    if (mic) return;
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no-audio'), { code: 'no-audio' });
    let stream;
    try { stream = await takeMic(); } catch (err) { throw micError(err); }
    const ac = audioContext();
    // Never waited on for long: outside a tap it does not settle, and the next tap wakes it (above).
    if (ac.state !== 'running') await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    debug.audio = ac.state;
    const srcNode = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    srcNode.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const m = { stream, ac, srcNode, analyser, buf, node: null, closed: false };
    const onSamples = (x) => { if (!m.closed) samples(resampleTo16k(x, ac.sampleRate)); };
    try {
      // Once per context: the context stays, and registering the processor again would fail.
      ac.voiceWorklet ||= ac.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
      await ac.voiceWorklet;
      m.node = new AudioWorkletNode(ac, 'voice-capture');
      m.node.port.onmessage = (e) => onSamples(e.data);
      srcNode.connect(m.node);
    } catch {
      // Older engines: the deprecated processor node does the same job.
      m.node = ac.createScriptProcessor(1024, 1, 1);
      m.node.onaudioprocess = (e) => onSamples(e.inputBuffer.getChannelData(0).slice(0));
      srcNode.connect(m.node);
      m.node.connect(ac.destination);
    }
    // A sink that plays nothing keeps the graph pulling on every engine.
    const mute = ac.createGain(); mute.gain.value = 0;
    m.node.connect?.(mute); mute.connect(ac.destination);
    m.mute = mute;
    mic = m;
    ep.reset();
    frames.length = 0; frameFill = 0; vadQueue.length = 0;
    vadReset = true;
    debug.mic = 'open';
    try { debug.micSettings = stream.getAudioTracks()[0].getSettings(); } catch { /* — */ }
  }
  function closeMic() {
    clearInterval(partialTimer); partialTimer = 0;
    const m = mic; mic = null;
    if (!m) return;
    m.closed = true;
    try { m.node?.disconnect(); m.srcNode.disconnect(); m.analyser.disconnect(); m.mute?.disconnect(); } catch { /* gone */ }
    if (m.node?.port) m.node.port.onmessage = null;
    m.stream.getTracks().forEach((t) => t.stop());
    // The context stays (audioContext()): a phone would not let a new one run without a tap.
    ep.reset();
    debug.mic = 'closed';
  }
  const userSource = {
    level: () => (mic ? ep.level : 0),
    wave(n) {
      const out = new Float32Array(n);
      if (!mic) return out;
      mic.analyser.getFloatTimeDomainData(mic.buf);
      const step = mic.buf.length / n;
      for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, mic.buf[Math.floor(i * step)] * 4));
      return out;
    },
  };
  let early = null;              // a sentence said and finished while the models were still loading
  // The microphone in frames of 512 samples (32 ms at 16 kHz), the VAD's frame. With the VAD, frames wait for their
  // probability (two at a time, one call in flight: about 64 ms behind); without it they go straight to loudness.
  const FRAME = ep.frameSamples;
  const frames = [];
  let frameBuf = new Float32Array(FRAME), frameFill = 0;
  const vadQueue = [];
  let vadBusy = false, vadReset = true;
  debug.vadRuns = 0; debug.vadMs = 0;
  function samples(x) {
    if (state.mode !== 'conversation' || state.phase === 'paused') return;
    let i = 0;
    while (i < x.length) {
      const k = Math.min(x.length - i, FRAME - frameFill);
      frameBuf.set(x.subarray(i, i + k), frameFill);
      frameFill += k; i += k;
      if (frameFill === FRAME) { (vad ? vadQueue : frames).push(frameBuf); frameBuf = new Float32Array(FRAME); frameFill = 0; }
    }
    if (frames.length) { const f = join(frames.splice(0)); handle(ep.push(f)); }
    if (vad) pumpVad();
  }
  const join = (list) => { const a = new Float32Array(list.length * FRAME); list.forEach((f, k) => a.set(f, k * FRAME)); return a; };
  function pumpVad() {
    if (vadBusy || !vadQueue.length || !vad) return;
    const batch = join(vadQueue.splice(0, Math.min(vadQueue.length, 4)));
    const copy = batch.slice();                       // the VAD's copy goes to its Worker
    vadBusy = true;
    const t0 = performance.now();
    const v = vad;
    v.run(copy, vadReset ? { reset: true } : {}).then((probs) => {
      vadReset = false;
      debug.vadRuns++; debug.vadMs += performance.now() - t0; debug.vadP = probs[probs.length - 1];
      if (mic && state.mode === 'conversation' && state.phase !== 'paused') handle(ep.push(batch, Array.from(probs)));
    }, (err) => {
      // The VAD failed while running: loudness from now on, and these frames are not lost.
      console.warn('[voice] voice activity failed: loudness only', err);
      if (vad === v) { vad = null; debug.vad = 'energy'; }
      handle(ep.push(batch));
    }).finally(() => { vadBusy = false; pumpVad(); });
  }
  function handle(events) {
    for (const e of events) {
      // Still loading (the microphone opens first, for its permission): what is said meanwhile is kept, not lost.
      if (state.phase === 'loading') { if (e.type === 'end') { early = e.audio; log('speech-kept'); } continue; }
      if (e.type === 'start') { log('speech-start'); dispatch({ type: 'SPEECH_START' }); startPartials(); }
      else if (e.type === 'end') { log('speech-end'); stopPartials(); dispatch({ type: 'SPEECH_END', audio: e.audio }); }
      else if (e.type === 'drop') { stopPartials(); dispatch({ type: 'SPEECH_DROP' }); }
    }
  }

  // ---------- Writing down what was said ----------
  let partial = '', heard = '';
  function startPartials() {
    partial = ''; render();
    if (!asr?.partials) return;
    clearInterval(partialTimer);
    partialTimer = setInterval(async () => {
      if (partialBusy || state.phase !== 'hearing') return;
      const a = ep.current();
      if (!a || a.length < 16000 * 0.8) return;
      partialBusy = true;
      try {
        const r = await asr.task.run(a, { language: lastLang || hooks.lang() });
        if (state.phase === 'hearing' && r?.text && !isHallucination(r.text)) { partial = r.text; debug.partials.push(partial); render(); }
      } catch { /* a partial is only a preview */ } finally { partialBusy = false; }
    }, 1100);
  }
  function stopPartials() { clearInterval(partialTimer); partialTimer = 0; }
  let asrCtl = null;
  async function finalAsr(audioIn) {
    asrCtl?.abort();
    const ctl = (asrCtl = new AbortController());
    try {
      const a = await loadAsr();
      const r = await a.task.run(audioIn, { detect: ['es', 'en'], prior: hooks.lang(), signal: ctl.signal });
      if (ctl.signal.aborted) return;
      let text = String(r?.text || '').trim();
      if (isHallucination(text)) text = '';
      if (r?.language) lastLang = r.language;
      heard = text; partial = '';
      log({ asr: text, language: r?.language || null });
      dispatch({ type: 'TRANSCRIPT', text, autoSend: settings.autoSend });
    } catch (err) {
      if (ctl.signal.aborted || err?.name === 'AbortError' || err?.code === 'aborted') return;
      console.warn('[voice] transcription failed', err);
      dispatch({ type: 'TRANSCRIPT', text: '' });
    }
  }

  // ---------- Reading aloud ----------
  // One audio element for every sentence: its playbackRate keeps the pitch (speed for Elffuss's own voice), and it plays
  // on phones after the first tap unlocked it. The orb reads the sentence's own samples at the playhead.
  const player = new Audio();
  player.preload = 'auto';
  if ('preservesPitch' in player) player.preservesPitch = true;
  const tts = { items: [], playing: null, gen: 0, ctl: null, lang: null, unlocked: false };
  // A phone reads with the device's own voice (speechSynthesis: Spain's Spanish voice on an iPhone): Elffuss's voice
  // did not fit in an iPhone tab next to the rest of the conversation (9-nov). No model, no memory of the tab. The
  // orb then moves with a made-up level, not the sound's.
  const nativeVoice = () => policy === 'turns' && typeof globalThis.speechSynthesis?.speak === 'function';
  function nativeVoiceFor(lang) {
    const want = lang === 'en' ? 'en-US' : 'es-ES';
    const all = globalThis.speechSynthesis.getVoices?.() || [];
    const same = all.filter((v) => v.lang?.replace('_', '-') === want);
    return same.find((v) => /m[oó]nica/i.test(v.name)) || same.find((v) => v.localService) || same[0] || all.find((v) => v.lang?.startsWith(want.slice(0, 2))) || null;
  }
  const madeUp = (t) => 0.35 + 0.3 * Math.abs(Math.sin(t / 95)) * Math.abs(Math.sin(t / 37));
  const botSource = {
    level() {
      const p = tts.playing;
      if (p?.native) return madeUp(performance.now());
      if (!p?.pcm || player.paused) return 0;
      const i = Math.floor(player.currentTime * p.pcm.rate), win = Math.round(p.pcm.rate * 0.03);
      let s = 0, n = 0;
      for (let k = Math.max(0, i - win); k < Math.min(p.pcm.samples.length, i + win); k++) { s += p.pcm.samples[k] ** 2; n++; }
      const db = 10 * Math.log10(s / Math.max(1, n) + 1e-12);
      return Math.min(1, Math.max(0, (db + 55) / 45));
    },
    wave(n) {
      const out = new Float32Array(n);
      const p = tts.playing;
      if (p?.native) { const t = performance.now(), a = madeUp(t) * 0.6; for (let k = 0; k < n; k++) out[k] = a * Math.sin(k * 0.7 + t / 60); return out; }
      if (!p?.pcm || player.paused) return out;
      const i = Math.floor(player.currentTime * p.pcm.rate), span = Math.round(p.pcm.rate * 0.025);
      for (let k = 0; k < n; k++) out[k] = Math.max(-1, Math.min(1, (p.pcm.samples[i + Math.floor((k * span) / n)] || 0) * 3));
      return out;
    },
  };
  // The answer's level at the playhead for the echo gate: the loudest 20 ms of the last 150 ms (the echo comes late).
  ep.setReference(() => {
    const p = tts.playing;
    if (!p?.pcm || player.paused) return -100;
    const rate = p.pcm.rate, x = p.pcm.samples, end = Math.floor(player.currentTime * rate), win = Math.round(rate * 0.02);
    let best = -100;
    for (let a = Math.max(0, end - Math.round(rate * 0.15)); a + win <= Math.min(x.length, end + win); a += win) {
      let s = 0; for (let k = a; k < a + win; k++) s += x[k] * x[k];
      best = Math.max(best, 10 * Math.log10(s / win + 1e-12));
    }
    return best;
  });
  function unlockAudio() {
    if (tts.unlocked) return;
    tts.unlocked = true;
    // A tenth of a second of silence, played from the tap that chose the mode: phones then let later sentences play.
    const n = 1600, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    const u = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    // Both players: the one for the answer and the one for «Un momento…» (a phone unlocks each element on its own).
    const plays = [player, fillerPlayer].map((el) => { el.src = u; return el.play().catch(() => {}); });
    Promise.all(plays).finally(() => setTimeout(() => URL.revokeObjectURL(u), 1000));
    // The device's voice too: iOS speaks later only if something was spoken from a tap.
    if (nativeVoice()) { try { const z = new SpeechSynthesisUtterance(' '); z.volume = 0; speechSynthesis.speak(z); } catch { /* — */ } }
  }
  const speakingModes = () => state.mode === 'speaker' || state.mode === 'conversation';
  function ttsReset() { ttsStop(); tts.lang = null; }
  function ttsStop() {
    stopFiller();
    if (nativeVoice()) { try { speechSynthesis.cancel(); } catch { /* — */ } }
    tts.gen++;
    tts.ctl?.abort(); tts.ctl = null;
    for (const it of tts.items) if (it.url) URL.revokeObjectURL(it.url);
    tts.items = [];
    if (tts.playing?.url) URL.revokeObjectURL(tts.playing.url);
    tts.playing = null;
    try { player.pause(); player.removeAttribute('src'); player.load(); } catch { /* — */ }
    caption = ''; render();
    silent();
  }
  /** A sentence to read. In the phone's turns, only kept until the answer is over and the chat model has gone. */
  function ttsFeed(text, lang) {
    if (!speakingModes()) return;
    tts.items.push({ text, lang, synth: null, url: null, pcm: null });
    debug.spoken.push({ text, lang });
    pump();
  }
  let holdForTurn = false;          // phones: nothing is synthesised while the chat model is loaded
  function pump() {
    if (holdForTurn) return;
    const gen = tts.gen;
    if (nativeVoice()) {
      const head = tts.items[0];
      if (tts.playing || !head) return;
      head.native = true;
      tts.playing = head;
      caption = head.text;
      stopFiller();
      const u = new SpeechSynthesisUtterance(head.text);
      u.lang = head.lang === 'en' ? 'en-US' : 'es-ES';
      const v = nativeVoiceFor(head.lang); if (v) u.voice = v;
      u.rate = Math.min(1.5, Math.max(0.7, settings.speed || 1));
      u.onstart = () => { if (gen === tts.gen) { log('audio-start'); dispatch({ type: 'AUDIO_START' }); } };
      u.onend = u.onerror = () => { if (gen === tts.gen) endOfSentence(head); };
      speechSynthesis.speak(u);
      render();
      return;
    }
    tts.ctl ||= new AbortController();
    // Two sentences synthesised ahead: the next one is ready when this one ends.
    for (const it of tts.items.slice(0, 2)) {
      if (it.synth) continue;
      it.synth = (async () => {
        const t0 = performance.now();
        const task = await loadSpeech(it.lang);
        const voice = voiceFor(it.lang);
        const r = await task.run({ text: it.text, lang: it.lang, voice, ...(isKokoro(voice) ? { speed: settings.speed } : {}) }, { signal: tts.ctl?.signal });
        if (gen !== tts.gen) return;
        it.url = URL.createObjectURL(r.blob);
        it.rate = isKokoro(voice) ? 1 : settings.speed;
        debug.synth = (debug.synth || []).concat({ text: it.text.slice(0, 40), ms: Math.round(performance.now() - t0), seconds: r.seconds ?? null, device: task.device ?? null }).slice(-30);
        try { it.pcm = parseWav(await r.blob.arrayBuffer()); } catch { it.pcm = null; }
      })().catch((err) => { if (gen === tts.gen && err?.name !== 'AbortError' && err?.code !== 'aborted') { console.warn('[voice] speech failed', err); it.failed = true; } });
    }
    const head = tts.items[0];
    if (!tts.playing && head) {
      head.synth.then(() => {
        if (gen !== tts.gen || tts.playing || tts.items[0] !== head) return;
        if (head.failed || !head.url) { tts.items.shift(); pump(); idleCheck(); return; }
        tts.playing = head;
        caption = head.text;
        player.src = head.url;
        player.playbackRate = head.rate || 1;
        if ('preservesPitch' in player) player.preservesPitch = true;
        stopFiller();
        player.play().then(() => { log('audio-start'); dispatch({ type: 'AUDIO_START' }); }, (err) => { console.warn('[voice] play', err); endOfSentence(head); });
        render();
      });
    }
  }
  function endOfSentence(it) {
    if (tts.playing !== it) return;
    if (it.url) URL.revokeObjectURL(it.url);
    tts.playing = null;
    tts.items.shift();
    caption = '';
    pump();
    idleCheck();
  }
  function idleCheck() {
    if (!tts.playing && !tts.items.length) { log('audio-idle'); dispatch({ type: 'AUDIO_IDLE' }); silent(); }
  }
  // Who waits for the reading to be over (the phone's turns: the voice goes before the ears come back).
  const silenceWaiters = new Set();
  function silent() { for (const r of silenceWaiters) r(); silenceWaiters.clear(); }
  const whenSilent = () => (!tts.playing && !tts.items.length ? Promise.resolve() : new Promise((r) => silenceWaiters.add(r)));
  player.addEventListener('ended', () => { if (tts.playing) endOfSentence(tts.playing); });
  player.addEventListener('error', () => { if (tts.playing) endOfSentence(tts.playing); });

  // ---------- The answer, as the chat writes it ----------
  const chunkers = new WeakMap();
  /** The text of one step of the answer so far (`final` when the step is over). */
  function answer(key, text, final = false) {
    if (!speakingModes() || state.phase === 'off' || !key) return;
    if (state.mode === 'conversation' && !['thinking', 'speaking'].includes(state.phase)) return;
    // What it is writing, on the conversation screen while nothing is read yet (the end of it, as it grows).
    const said = speakable(text);
    if (said && said !== liveText) { liveText = said; if (state.phase === 'thinking' && !liveQueued) { liveQueued = true; requestAnimationFrame(() => { liveQueued = false; render(); }); } }
    let c = chunkers.get(key);
    if (!c) { c = createChunker(); chunkers.set(key, c); }
    const out = final ? c.flush(text) : c.push(text);
    for (const s of out) {
      tts.lang ||= textLang(s + ' ' + text.slice(0, 200), lastLang || hooks.lang());
      ttsFeed(s, tts.lang);
    }
  }
  async function beforeTurn() {
    if (!speakingModes()) return;
    if (policy === 'turns') {
      // A phone: the voice models leave the tab's memory to the chat model; what it writes is read after.
      holdForTurn = true;
      if (state.mode === 'conversation') closeMic();
      await disposeModels();
    }
  }
  // ---------- Fast voice turns ----------
  // A turn the voice reads aloud answers at once (chat.js: no reasoning unless «Pensar antes de responder», a short
  // spoken answer). If after FILLER_MS there is still nothing to read, a short «Un momento…» (made once with the voice
  // while it is loaded, and kept) says it is working: on a phone the first sentence can take a while.
  const FILLER_MS = 3000;
  const fillers = new Map();           // lang → { url, pcm }
  const fillerPlayer = new Audio();
  let fillerTimer = 0, liveText = '', liveQueued = false;
  async function makeFiller(lang) {
    if (fillers.has(lang) || !speech) return;
    fillers.set(lang, null);
    try {
      const voice = voiceFor(lang);
      const r = await speech.run({ text: WORDS[lang].filler, lang, voice, ...(isKokoro(voice) ? { speed: settings.speed } : {}) });
      fillers.set(lang, { url: URL.createObjectURL(r.blob) });
    } catch (err) { fillers.delete(lang); console.warn('[voice] filler', err); }
  }
  function armFiller() {
    clearTimeout(fillerTimer);
    fillerTimer = setTimeout(() => {
      const waiting = (state.mode === 'conversation' && state.phase === 'thinking') || (state.mode === 'speaker' && state.phase === 'idle' && !state.turnDone);
      if (!waiting || tts.playing || tts.items.some((it) => it.url)) return;
      const f = fillers.get(lastLang || hooks.lang()) || fillers.get(hooks.lang());
      if (!f?.url) return;
      log('filler');
      fillerPlayer.src = f.url;
      fillerPlayer.play().catch(() => {});
    }, FILLER_MS);
  }
  function stopFiller() { clearTimeout(fillerTimer); fillerTimer = 0; try { fillerPlayer.pause(); } catch { /* — */ } }
  function turnStarted() { log('turn-start'); liveText = ''; dispatch({ type: 'TURN_START' }); if (speakingModes()) armFiller(); }
  async function turnEnded({ msg = null } = {}) {
    stopFiller();
    if (msg) answer(msg, msg.content || '', true);
    log('turn-end');
    const speaking = !!(tts.items.length || tts.playing);
    dispatch({ type: 'TURN_END', speaking });
    if (policy === 'turns' && holdForTurn) {
      holdForTurn = false;
      if (!speakingModes()) return;
      if (tts.items.length) await hooks.unloadLlm().catch(() => {});
      if (state.mode === 'conversation') {
        // One model at a time on a phone: the tab is killed past 2 GB (measured on an iPhone, 9-nov, with Whisper,
        // the VAD and the voice loading together). The answer is read with the voice alone; then the voice goes and
        // the ears come back.
        if (tts.items.length || tts.playing) { pump(); await whenSilent(); await disposeSpeech(); }
        if (state.mode !== 'conversation') return;
        try { await Promise.all([loadAsr(), loadVad()]); if (!['paused', 'error', 'off'].includes(state.phase)) await openMic(); } catch (err) { console.warn('[voice] after the turn', err); noteError(err); dispatch({ type: 'FAILED', error: err?.code || 'failed' }); }
      }
      pump();
    }
  }

  // ---------- Effects ----------
  let preparing = null;
  async function prepare() {
    const mode = state.mode;
    if (preparing) return preparing;
    preparing = (async () => {
      try {
        const p = await plan(mode);
        if (p.error) throw Object.assign(new Error(p.error), { code: p.error });
        debug.plan = p.items.map((it) => ({ key: it.key, bytes: it.bytes, missing: it.missing, files: it.files.length }));
        if (!settings.seen || p.missing > 0) {
          // Something to download: first the product's own question (on an iPhone tab, install the app first).
          if (p.missing > 0 && hooks.beforeDownload && !(await hooks.beforeDownload())) { setMode('text'); return; }
          // One question for all of it; then the microphone's own (asked now, so nobody has to come back for it at
          // the end of a long download); then everything downloads together, and the same window shows how it goes.
          const yes = await consent(mode, p);
          if (!yes) { setMode('text'); return; }
          settings.seen = true; keep();
        } else if (mode === 'conversation') await askMic({ keep: true });
        if (state.mode !== mode) return;
        loadPct = null; render();
        // A phone loads the voice when the answer being written is over (it used to return here, and with no turn of
        // its own to end, nothing loaded it: «Preparando la voz…» for ever).
        while (policy === 'turns' && hooks.turnRunning()) { await new Promise((r) => setTimeout(r, 200)); if (state.mode !== mode) { if (mode === 'conversation') dropMic(); return; } }
        if (mode === 'conversation') {
          await openMic();                        // the permission question first: it is the one the user must answer
          if (policy === 'turns') {
            // A phone starts by listening only: the voice loads when there is an answer to read, on its own (all three
            // at once went past the tab's 2 GB on an iPhone). No «Un momento…» there: it needs the voice loaded.
            await hooks.unloadLlm().catch(() => {});
            await Promise.all([loadAsr(), loadVad()]);
          } else await Promise.all([loadAsr(), loadVad(), loadSpeech(hooks.lang()).then(() => makeFiller(hooks.lang())).catch((e) => console.warn('[voice] voice', e))]);
        } else {
          await loadSpeech(hooks.lang()).then(() => makeFiller(hooks.lang())).catch((e) => console.warn('[voice] voice', e));
        }
        if (state.mode !== mode) { if (mode === 'conversation' && state.mode !== 'conversation') closeMic(); return; }
        loadPct = null;
        dispatch({ type: 'READY' });
      } catch (err) {
        console.warn('[voice] prepare', err);
        noteError(err);
        if (state.mode === mode) dispatch({ type: 'FAILED', error: err?.code || 'failed' });
      }
    })().finally(() => { preparing = null; });
    return preparing;
  }

  function apply(effects) {
    for (const e of effects) {
      const type = typeof e === 'string' ? e : e.type;
      switch (type) {
        case 'prepare': prepare(); break;
        case 'mic.open': openMic().catch((err) => dispatch({ type: 'FAILED', error: err?.code || 'no-audio' })); break;
        case 'mic.close': closeMic(); break;
        case 'mic.pause': stopPartials(); closeMic(); break;
        case 'mic.resume': openMic().catch((err) => dispatch({ type: 'FAILED', error: err?.code || 'no-audio' })); break;
        case 'mic.end': { log('mic-end'); stopPartials(); const r = ep.end(); if (r?.type === 'end') dispatch({ type: 'SPEECH_END', audio: r.audio }); else dispatch({ type: 'SPEECH_DROP' }); break; }
        case 'barge.on': ep.setBargeIn(true); break;
        case 'barge.off': ep.setBargeIn(false); break;
        case 'asr.final': finalAsr(e.audio); break;
        case 'asr.cancel': asrCtl?.abort(); stopPartials(); break;
        case 'send': log({ send: e.text }); hooks.send(e.text); break;
        case 'tts.reset': ttsReset(); break;
        case 'tts.stop': log('tts-stop'); ttsStop(); break;
        case 'turn.stop': log('turn-stop'); hooks.stopTurn(); break;
        default: break;
      }
    }
  }
  function dispatch(ev) {
    const r = reduce(state, ev);
    const was = state;
    state = r.state;
    debug.state = state;
    if (was.phase !== state.phase || was.mode !== state.mode) log(`${state.mode}:${state.phase}`);
    apply(r.effects);
    render();
    // The microphone opens before the models finish loading: someone who started talking meanwhile is already
    // under way when it is ready (measured: the first question was lost, its end came in «listening»).
    if (ev.type === 'READY' && state.phase === 'listening') {
      if (early) { const a = early; early = null; log('speech-start'); dispatch({ type: 'SPEECH_START' }); log('speech-end'); dispatch({ type: 'SPEECH_END', audio: a }); }
      else if (ep.speaking) { log('speech-start'); dispatch({ type: 'SPEECH_START' }); startPartials(); }
    }
    if (ev.type === 'MODE') early = null;
  }
  function setMode(mode) {
    if (!MODES.includes(mode)) return;
    // Called from the tap that chose it: the sound wakes now, and a conversation asks for the microphone now.
    if (mode !== 'text') wake();
    if (mode === 'conversation') askMicNow(); else dropMic();
    settings.mode = mode === 'conversation' ? settings.mode : mode;
    if (mode !== 'conversation') { settings.mode = mode; keep(); }
    minimized = false;
    if (mode !== 'conversation' && state.mode === 'conversation') disposeIfIdle();
    dispatch({ type: 'MODE', mode });
  }
  // The models stay while the speaker is on; leaving every voice mode lets them go.
  function disposeIfIdle() { setTimeout(() => { if (state.mode === 'text') disposeModels(); else if (state.mode === 'speaker') { const a = asr, v = vad; asr = null; vad = null; debug.vad = 'off'; a?.task.dispose?.(); v?.dispose?.(); } }, 0); }

  // ---------- The top bar control and its panel ----------
  const chip = hooks.chip;
  const pop = document.createElement('div');
  pop.className = 'voice-pop';
  pop.id = 'voice-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'voice-pop-h');
  document.body.append(pop);
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-controls', 'voice-pop');
  chip.setAttribute('aria-expanded', 'false');
  chip.hidden = false;
  const scrim = document.createElement('div');
  scrim.className = 'voice-pop-scrim'; scrim.hidden = true;
  document.body.append(scrim);
  const openPop = () => {
    paintPop();
    pop.hidden = false; scrim.hidden = false;
    document.documentElement.classList.add('voice-pop-open');
    chip.setAttribute('aria-expanded', 'true');
    place();
    pop.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  };
  const closePop = (focus = true) => { if (pop.hidden) return; pop.hidden = true; scrim.hidden = true; document.documentElement.classList.remove('voice-pop-open'); chip.setAttribute('aria-expanded', 'false'); if (focus) chip.focus({ preventScroll: true }); };
  function place() {
    if (matchMedia('(max-width: 600px)').matches) { pop.style.left = ''; pop.style.top = ''; pop.style.right = ''; return; }
    const r = chip.getBoundingClientRect();
    const width = Math.min(360, innerWidth - 24);
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.left = `${Math.round(Math.max(12, Math.min(innerWidth - width - 12, r.right - width)))}px`;
  }
  chip.addEventListener('click', () => {
    if (state.mode === 'conversation' && minimized) { restore(); return; }
    if (pop.hidden) openPop(); else closePop();
  });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !chip.contains(e.target)) closePop(false); }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) { closePop(); return; }
    if (e.key === 'Escape' && state.mode === 'conversation' && !minimized && !document.querySelector('dialog[open]')) setMode('text');
  });
  addEventListener('resize', () => { if (!pop.hidden) place(); });

  function field(label, control, extra = null) {
    const row = document.createElement('label');
    row.className = 'vp-field';
    const span = document.createElement('span'); span.className = 'vp-label'; span.textContent = label;
    row.append(span, control);
    if (extra) row.append(extra);
    return row;
  }
  const num = (n, d = 1) => new Intl.NumberFormat(hooks.lang() === 'es' ? 'es-ES' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  function paintPop() {
    const W = w();
    pop.innerHTML = '';
    pop.setAttribute('aria-label', W.modeTitle);
    const head = document.createElement('div'); head.className = 'vp-head';
    const h = document.createElement('h2'); h.id = 'voice-pop-h'; h.className = 'vp-h'; h.textContent = W.modeTitle;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'vp-close'; x.setAttribute('aria-label', W.close);
    x.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-close"/></svg>';
    x.addEventListener('click', () => closePop());
    head.append(h, x);
    // The two ways to use the voice, big; «Texto» (the voice off) under them, smaller; the settings folded below
    // (Kiko: «botones de las opciones más grandes, pon las dos principales y luego más opciones debajo, pero que no
    // se vea del tirón»). One radio group for the three, arrows move between them.
    const group = document.createElement('div');
    group.className = 'vp-modes'; group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', 'voice-pop-h');
    const main = document.createElement('div'); main.className = 'vp-main';
    const radio = (m, cls, inner) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.dataset.mode = m;
      b.setAttribute('role', 'radio');
      const on = state.mode === m;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.innerHTML = inner;
      b.querySelector('.vp-name').textContent = W.modes[m][0];
      const line = b.querySelector('.vp-line'); if (line) line.textContent = W.modes[m][1];
      b.addEventListener('click', () => { closePop(false); setMode(m); if (m !== 'conversation') chip.focus({ preventScroll: true }); });
      b.addEventListener('keydown', (e) => {
        const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!k) return;
        e.preventDefault();
        const all = [...group.querySelectorAll('[role="radio"]')];
        all[(all.indexOf(b) + k + all.length) % all.length].focus();
      });
      return b;
    };
    const tick = '<span class="vp-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></span>';
    main.append(
      radio('conversation', 'vp-card vp-card-talk', `<span class="vp-art" aria-hidden="true"><span class="vp-orb"></span><svg class="ic" aria-hidden="true"><use href="#${ICON.conversation}"/></svg></span><span class="vp-name"></span><span class="vp-line"></span>${tick}`),
      radio('speaker', 'vp-card vp-card-speak', `<span class="vp-art" aria-hidden="true"><svg class="ic" aria-hidden="true"><use href="#${ICON.speaker}"/></svg></span><span class="vp-name"></span><span class="vp-line"></span>${tick}`),
    );
    const off = radio('text', 'vp-off', `<svg class="ic" aria-hidden="true"><use href="#${ICON.text}"/></svg><span class="vp-name"></span><span class="vp-line"></span>${tick}`);
    group.append(main, off);
    // One radio is in the tab order: the checked one.
    if (![...group.querySelectorAll('[role="radio"]')].some((r) => r.tabIndex === 0)) group.querySelector('[role="radio"]').tabIndex = 0;
    const sets = document.createElement('details');
    sets.className = 'vp-more';
    const sh = document.createElement('summary'); sh.className = 'vp-sub';
    sh.innerHTML = '<span></span><svg class="vp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    sh.firstChild.textContent = W.more;
    const body = document.createElement('div'); body.className = 'vp-settings';
    const voiceSelect = (lang) => {
      const s = document.createElement('select');
      s.className = 'vp-select';
      for (const v of voices.filter((x) => x.lang === lang)) { const o = document.createElement('option'); o.value = v.id; o.textContent = W.voiceName(v); s.append(o); }
      s.value = voiceFor(lang);
      s.addEventListener('change', () => { if (lang === 'en') settings.voiceEn = s.value; else settings.voiceEs = s.value; keep(); speechLangs.delete(lang); });
      return s;
    };
    const range = (r, value, fmt, on) => {
      const i = document.createElement('input');
      i.type = 'range'; i.min = r.min; i.max = r.max; i.step = r.step; i.value = value; i.className = 'vp-range';
      const out = document.createElement('output'); out.className = 'vp-out'; out.textContent = fmt(value);
      i.addEventListener('input', () => { out.textContent = fmt(Number(i.value)); on(Number(i.value)); keep(); });
      return [i, out];
    };
    const [speedIn, speedOut] = range(SPEED, settings.speed, (v) => `${num(v, 2)}×`, (v) => { settings.speed = v; });
    const [pauseIn, pauseOut] = range(PAUSE, settings.pauseMs, (v) => `${num(v / 1000, 1)} s`, (v) => { settings.pauseMs = v; ep.set({ silenceMs: v }); });
    pauseIn.setAttribute('aria-describedby', 'vp-pause-hint');
    const hint = document.createElement('span'); hint.id = 'vp-pause-hint'; hint.className = 'vp-hint'; hint.textContent = W.pauseHint;
    const pauseRow = field(W.pause, pauseIn, pauseOut); pauseRow.append(hint);
    const auto = document.createElement('input');
    auto.type = 'checkbox'; auto.className = 'vp-check'; auto.checked = settings.autoSend; auto.setAttribute('role', 'switch');
    auto.addEventListener('change', () => { settings.autoSend = auto.checked; keep(); });
    const autoRow = document.createElement('label'); autoRow.className = 'vp-field vp-switch';
    const autoLabel = document.createElement('span'); autoLabel.className = 'vp-label'; autoLabel.textContent = W.autoSend;
    autoRow.append(autoLabel, auto);
    const think = document.createElement('input');
    think.type = 'checkbox'; think.className = 'vp-check'; think.checked = !!settings.think; think.setAttribute('role', 'switch');
    think.setAttribute('aria-describedby', 'vp-think-hint');
    think.addEventListener('change', () => { settings.think = think.checked; keep(); });
    const thinkRow = document.createElement('label'); thinkRow.className = 'vp-field vp-switch';
    const thinkLabel = document.createElement('span'); thinkLabel.className = 'vp-label'; thinkLabel.textContent = W.think;
    const thinkHint = document.createElement('span'); thinkHint.id = 'vp-think-hint'; thinkHint.className = 'vp-hint'; thinkHint.textContent = W.thinkHint;
    thinkRow.append(thinkLabel, think, thinkHint);
    body.append(field(W.voiceEs, voiceSelect('es')), field(W.voiceEn, voiceSelect('en')),
      field(W.speed, speedIn, speedOut), pauseRow, autoRow, thinkRow);
    sets.append(sh, body);
    // Opened at the bottom of a short popover, the settings are brought into view.
    sets.addEventListener('toggle', () => { if (sets.open) requestAnimationFrame(() => body.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })); });
    const fine = document.createElement('p'); fine.className = 'vp-fine'; fine.textContent = W.onDevice;
    pop.append(head, group, fine, sets);
  }

  // ---------- The conversation screen ----------
  const st = document.createElement('section');
  st.className = 'voice-stage';
  st.id = 'voice-stage';
  st.hidden = true;
  st.innerHTML = `
    <div class="vs-orbs"><canvas class="vs-canvas" aria-hidden="true"></canvas><button class="vs-orb-btn" type="button"></button></div>
    <div class="vs-text">
      <p class="vs-status" role="status" aria-live="polite"><span class="vs-phase"></span><span class="vs-hint"></span></p>
      <p class="vs-heard" aria-live="polite"></p>
      <p class="vs-caption"></p>
      <div class="vs-review" hidden><button type="button" class="vs-btn vs-discard"></button><button type="button" class="vs-btn vs-send"></button></div>
    </div>
    <div class="vs-bar">
      <button type="button" class="vs-btn vs-pause"></button>
      <button type="button" class="vs-btn vs-chat"></button>
      <button type="button" class="vs-btn vs-exit"></button>
    </div>`;
  hooks.stage.append(st);
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'vs-back'; back.hidden = true;
  hooks.stage.append(back);
  const q = (s) => st.querySelector(s);
  const orbs = createOrbs(q('.vs-canvas'), { reduced: reduceMotion() });
  orbs.set({ user: userSource, bot: botSource });
  q('.vs-orb-btn').addEventListener('click', () => { wake(); dispatch({ type: 'TAP' }); });
  q('.vs-send').addEventListener('click', () => dispatch({ type: 'SEND', text: heard }));
  q('.vs-discard').addEventListener('click', () => { heard = ''; dispatch({ type: 'DISCARD' }); });
  q('.vs-pause').addEventListener('click', () => {
    wake();
    if (state.phase === 'paused') dispatch({ type: 'TAP' });
    else if (state.phase === 'listening') dispatch({ type: 'TAP' });
    else { dispatch({ type: 'TAP' }); if (state.phase === 'listening') dispatch({ type: 'TAP' }); }
  });
  q('.vs-exit').addEventListener('click', () => { setMode('text'); hooks.input?.focus({ preventScroll: true }); });
  q('.vs-chat').addEventListener('click', () => minimize());
  back.addEventListener('click', () => restore());
  let caption = '';
  let minimized = false;
  function minimize() {
    if (state.mode !== 'conversation') return;
    minimized = true;
    if (state.phase === 'listening' || state.phase === 'hearing') dispatch({ type: 'TAP' });
    if (state.phase === 'hearing') dispatch({ type: 'TAP' });
    render();
    back.focus({ preventScroll: true });
  }
  function restore() {
    minimized = false;
    if (state.phase === 'paused') dispatch({ type: 'TAP' });
    render();
    q('.vs-orb-btn').focus({ preventScroll: true });
  }

  function render() {
    const W = w();
    const mode = state.mode;
    chip.dataset.mode = mode;
    chip.classList.toggle('is-on', mode !== 'text');
    chip.classList.toggle('is-busy', (mode === 'speaker' && state.phase === 'speaking') || (mode === 'conversation' && minimized));
    // In text mode the control says what it opens (the voice); in a voice mode, which one is on.
    chip.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#${mode === 'text' ? ICON.conversation : ICON[mode]}"/></svg><span class="voice-label" aria-hidden="true"></span>`;
    chip.querySelector('.voice-label').textContent = mode === 'text' ? W.chip : W.modes[mode][0];
    const label = `${W.modeTitle}: ${W.modes[mode][0]}${mode === 'conversation' && minimized ? ' · ' + W.backTo : ''}`;
    chip.setAttribute('aria-label', label);
    chip.title = label;
    const conv = mode === 'conversation';
    const showStage = conv && !minimized;
    if (st.hidden === showStage) {
      st.hidden = !showStage;
      document.documentElement.classList.toggle('voice-open', showStage);
      if (showStage) { orbs.start(); requestAnimationFrame(() => q('.vs-orb-btn').focus({ preventScroll: true })); } else orbs.stop();
    }
    back.hidden = !(conv && minimized);
    back.textContent = W.backTo;
    if (!conv) return;
    const ph = state.phase;
    orbs.set({ phase: ph });
    st.dataset.phase = ph;
    q('.vs-phase').textContent = ph === 'loading' && loadPct != null ? W.progress(loadPct) : W.phases[ph] || '';
    q('.vs-hint').textContent = ph === 'error' ? (W.errors[state.error] || W.errors.failed) : W.hints[ph] || '';
    q('.vs-orb-btn').setAttribute('aria-label', W.orbLabel[ph] || W.phases[ph] || '');
    q('.vs-orb-btn').disabled = ph === 'loading' || ph === 'transcribing' || ph === 'review';
    const heardLine = ph === 'hearing' ? partial : ['transcribing', 'review', 'thinking', 'speaking'].includes(ph) ? heard
      : ph === 'error' && !(state.error in W.errors && state.error !== 'failed') ? lastError : '';
    q('.vs-heard').textContent = heardLine;
    q('.vs-heard').classList.toggle('is-partial', ph === 'hearing');
    q('.vs-caption').textContent = ph === 'speaking' ? caption : ph === 'thinking' && liveText ? (liveText.length > 140 ? '…' + liveText.slice(-140) : liveText) : '';
    q('.vs-review').hidden = ph !== 'review';
    q('.vs-send').textContent = W.send; q('.vs-discard').textContent = W.discard;
    const pb = q('.vs-pause');
    pb.textContent = ph === 'paused' ? W.resumeBtn : W.pauseBtn;
    pb.setAttribute('aria-pressed', String(ph === 'paused'));
    pb.disabled = ['loading', 'error', 'transcribing', 'review'].includes(ph);
    q('.vs-chat').textContent = W.showChat;
    q('.vs-exit').textContent = W.exit;
    st.setAttribute('aria-label', W.modes.conversation[0]);
  }

  // ---------- First use ----------
  /** The microphone's permission, asked now and let go at once (the mode opens it for real when it is ready). */
  // The answer to the question the tap asked (askMicNow); `keep` holds the microphone for openMic(), which follows at
  // once, and without it the microphone is let go (a long download comes first; the permission stays).
  async function askMic({ keep = false } = {}) {
    let st;
    try { st = await takeMic(); } catch (err) { throw micError(err); }
    if (keep && state.mode === 'conversation') micAsk = Promise.resolve(st);
    else st.getTracks().forEach((t) => t.stop());
  }

  /**
   * One question for everything the mode downloads, with the total and, folded, what each part is; after «yes» the
   * same window shows one progress for all of it (each part's own line folded), can be left to go on in the
   * background, and offers to try again when the download is cut. Resolves true once all is here, false for «no».
   */
  function consent(mode, p) {
    return new Promise((resolve, reject) => {
      const W = w();
      const L = hooks.lang();
      const fmt = (n) => formatBytes(n, L);
      const d = document.createElement('dialog');
      d.className = 'voice-consent';
      d.setAttribute('aria-labelledby', 'vc-h');
      const size = p.missing > 0 ? fmt(p.missing) : '';
      d.innerHTML = `<div class="vc-orb" aria-hidden="true"></div><h2 id="vc-h"></h2><p class="vc-body"></p><p class="vc-mic"></p>
        <details class="vc-list"><summary></summary><ul></ul></details>
        <div class="vc-progress" hidden><div class="meter"><i></i></div><p class="vc-state" role="status" aria-live="polite"></p></div>
        <div class="vc-actions"><button type="button" class="vs-btn vc-no"></button><button type="button" class="btn vc-go"></button></div>`;
      d.querySelector('h2').textContent = W.consentTitle[mode];
      d.querySelector('.vc-body').textContent = W.consentBody[mode];
      const micP = d.querySelector('.vc-mic');
      if (mode === 'conversation') micP.textContent = W.consentMic; else micP.remove();
      const list = d.querySelector('.vc-list');
      const ul = list.querySelector('ul');
      const rows = new Map();
      if (p.items.length) {
        const sum = list.querySelector('summary');
        sum.innerHTML = '<span></span><svg class="vp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
        sum.firstChild.textContent = p.missing > 0 ? W.what(fmt(p.missing)) : W.what(W.stored);
        for (const it of p.items) {
          const li = document.createElement('li');
          li.innerHTML = '<span class="vc-item"></span><span class="vc-amount"></span>';
          li.firstChild.textContent = W.items[it.key] || it.key;
          li.lastChild.textContent = it.missing > 0 ? fmt(it.missing) : W.stored;
          ul.append(li); rows.set(it.key, li);
        }
      } else list.remove();
      const go = d.querySelector('.vc-go'), no = d.querySelector('.vc-no');
      no.textContent = W.consentNo;
      go.textContent = W.consentGo(size);
      const prog = d.querySelector('.vc-progress'), bar = prog.querySelector('.meter i'), said = prog.querySelector('.vc-state');
      let phase = 'ask', settled = false;
      const close = () => { try { d.close(); } catch { /* closed */ } d.remove(); };
      const settle = (v) => { if (settled) return; settled = true; resolve(v); };
      let last = { loaded: 0, total: p.missing };
      const show = (x) => {
        last = x;
        const pct = Math.floor((100 * x.loaded) / (x.total || 1));
        bar.style.width = `${pct}%`;
        prog.querySelector('.meter').setAttribute('aria-valuenow', String(pct));
        said.textContent = W.getting(fmt(x.loaded), fmt(x.total), pct);
        for (const r of x.items) { const li = rows.get(r.key); if (li && r.missing > 0) li.lastChild.textContent = `${Math.floor((100 * r.loaded) / r.missing)} %`; }
        loadPct = pct; render();
      };
      const run = async () => {
        phase = 'getting';
        prog.hidden = false; go.hidden = true; no.textContent = W.later; no.dataset.role = 'later';
        prog.querySelector('.meter').setAttribute('role', 'progressbar');
        prog.querySelector('.meter').setAttribute('aria-valuemin', '0'); prog.querySelector('.meter').setAttribute('aria-valuemax', '100');
        try {
          if (mode === 'conversation') await askMic();
          await batch(p, show);
          said.textContent = W.gotAll; bar.style.width = '100%';
          for (const it of p.items) { const li = rows.get(it.key); if (li) li.lastChild.textContent = W.stored; }
          log('batch-done');
          setTimeout(close, 400);
          settle(true);
        } catch (err) {
          if (err?.code === 'mic-denied' || err?.code === 'mic-missing' || err?.code === 'no-audio') { close(); if (!settled) { settled = true; reject(err); } return; }
          console.warn('[voice] the download was cut', err);
          log('batch-failed');
          phase = 'failed';
          said.textContent = W.failedGet(fmt(last.loaded), fmt(last.total));
          go.hidden = false; go.textContent = W.retry;
          no.textContent = W.cancel; no.dataset.role = 'cancel';
          if (!d.open) { document.body.append(d); d.showModal(); }
        }
      };
      go.addEventListener('click', () => { wake(); if (mode === 'conversation') askMicNow(); if (phase === 'ask' || phase === 'failed') run(); });
      no.addEventListener('click', () => {
        if (phase === 'getting') { close(); return; }               // it goes on; the screen and the chip show it
        close(); settle(false);
      });
      d.addEventListener('cancel', (e) => { e.preventDefault(); if (phase === 'getting') close(); else { close(); settle(false); } });
      document.body.append(d);
      d.showModal();
      go.focus();
    });
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) dispatch({ type: 'HIDDEN' }); });
  hooks.live?.(() => { if (!pop.hidden) paintPop(); render(); });
  render();
  if (settings.mode === 'speaker') dispatch({ type: 'MODE', mode: 'speaker' });

  return {
    /** The text of one step of an answer so far; `key` is that step's message. */
    answer,
    beforeTurn, turnStarted, turnEnded,
    /** In a voice mode, how this turn should answer: { think } (the «Pensar antes de responder» setting); else null. */
    fastTurn: () => (speakingModes() ? { think: !!settings.think } : null),
    /** The user typed in the box: reading stops. */
    userTyped: () => { if (state.mode !== 'text' && (state.phase === 'speaking' || tts.items.length)) dispatch({ type: 'USER_TYPED' }); },
    stopPressed: () => dispatch({ type: 'STOP_PRESSED' }),
    /** A card in the chat waits for the user (a download, a permission): the conversation steps aside to show it. */
    attention: () => { if (state.mode === 'conversation' && !minimized) minimize(); },
    get mode() { return state.mode; },
    get phase() { return state.phase; },
    setMode,
  };
}
