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

import { createEndpointer, resampleTo16k, createChunker, textLang, isHallucination, reduce, initialState, parseWav, MODES } from './voice-core.js';
import { createOrbs } from './voice-orb.js';
import { formatBytes } from './media-tools.js';

const KEY = 'elffuss.voice';
const SPEED = { min: 0.8, max: 1.4, step: 0.05 };
const PAUSE = { min: 400, max: 2000, step: 100 };
const DEFAULTS = { mode: 'text', voiceEs: 'es_elffuss', voiceEn: 'af_heart', speed: 1, pauseMs: 800, autoSend: true, seen: false };
// The voices when the SDK copy does not list them (its audio module gives VOICES).
const FALLBACK_VOICES = [
  { id: 'es_elffuss', name: 'Elffuss', lang: 'es', gender: 'f', model: 'moss' }, { id: 'ef_dora', name: 'Dora', lang: 'es', gender: 'f', model: 'kokoro' },
  { id: 'em_alex', name: 'Alex', lang: 'es', gender: 'm', model: 'kokoro' }, { id: 'af_heart', name: 'Heart', lang: 'en', gender: 'f', model: 'kokoro' },
  { id: 'af_bella', name: 'Bella', lang: 'en', gender: 'f', model: 'kokoro' }, { id: 'am_michael', name: 'Michael', lang: 'en', gender: 'm', model: 'kokoro' },
];

const WORDS = {
  es: {
    chip: 'Voz', modeTitle: 'Modo de voz',
    modes: { text: ['Texto', 'Escribes y lees, como siempre'], speaker: ['Altavoz', 'Lee en voz alta cada respuesta'], conversation: ['Conversación', 'Hablas y te contesta, sin manos'] },
    settings: 'Ajustes', voiceEs: 'Voz en español', voiceEn: 'Voz en inglés', speed: 'Velocidad', pause: 'Pausa para terminar',
    pauseHint: 'Silencio que hace falta para dar por acabada tu frase', autoSend: 'Enviar al terminar de hablar',
    onDevice: 'Todo ocurre en este dispositivo: ni tu voz ni el texto salen del navegador.',
    voiceName: (v) => (v.model === 'moss' ? `${v.name}, la voz de Elffuss` : `${v.name} · ${v.gender === 'm' ? 'masculina' : 'femenina'}`),
    phases: {
      loading: 'Preparando la voz…', listening: 'Te escucho', hearing: 'Te oigo…', transcribing: 'Escribiendo lo que has dicho…',
      review: '¿Lo envío?', thinking: 'Pensando…', speaking: 'Elffuss responde', paused: 'En pausa', error: 'No ha podido empezar',
    },
    hints: {
      listening: 'Habla cuando quieras', hearing: 'Toca para terminar', thinking: 'Toca para interrumpir', speaking: 'Habla o toca para interrumpir',
      paused: 'Toca el círculo para seguir', loading: '', transcribing: '', review: '', error: 'Toca el círculo para reintentar',
    },
    orbLabel: { listening: 'Pausar la escucha', hearing: 'Terminar la frase', thinking: 'Interrumpir', speaking: 'Interrumpir', paused: 'Seguir escuchando', error: 'Reintentar', loading: 'Preparando', transcribing: 'Escribiendo', review: 'Esperando' },
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
    modes: { text: ['Text', 'You type and read, as usual'], speaker: ['Speaker', 'Reads every answer aloud'], conversation: ['Conversation', 'You talk, it answers, hands free'] },
    settings: 'Settings', voiceEs: 'Spanish voice', voiceEn: 'English voice', speed: 'Speed', pause: 'Pause to finish',
    pauseHint: 'How much silence ends what you are saying', autoSend: 'Send when you stop talking',
    onDevice: 'Everything happens on this device: neither your voice nor the text leaves the browser.',
    voiceName: (v) => (v.model === 'moss' ? `${v.name}, Elffuss's own voice` : `${v.name} · ${v.gender === 'm' ? 'male' : 'female'}`),
    phases: {
      loading: 'Getting the voice ready…', listening: 'Listening', hearing: 'Hearing you…', transcribing: 'Writing down what you said…',
      review: 'Send it?', thinking: 'Thinking…', speaking: 'Elffuss is answering', paused: 'Paused', error: 'Could not start',
    },
    hints: {
      listening: 'Talk whenever you like', hearing: 'Tap to finish', thinking: 'Tap to interrupt', speaking: 'Talk or tap to interrupt',
      paused: 'Tap the circle to go on', loading: '', transcribing: '', review: '', error: 'Tap the circle to try again',
    },
    orbLabel: { listening: 'Pause listening', hearing: 'Finish the sentence', thinking: 'Interrupt', speaking: 'Interrupt', paused: 'Listen again', error: 'Try again', loading: 'Getting ready', transcribing: 'Writing', review: 'Waiting' },
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
 *   unloadLlm: () => Promise<void>, chatModel: () => ({ missing: boolean, bytes: number }), approveChatModel: () => void,
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
  async function disposeModels() {
    const a = asr, s = speech;
    asr = null; speech = null; speechLangs = new Set();
    await Promise.all([a?.task.dispose?.(), s?.dispose?.()].map((p) => Promise.resolve(p).catch(() => {})));
  }

  /** What the mode would download here: { voice, chat } bytes still missing. */
  async function missing(mode) {
    const e = await hooks.kit.env();
    let bytes = 0;
    try {
      const mod = await audio();
      const langs = [...new Set([hooks.lang(), hooks.lang() === 'es' ? 'en' : 'es'])];
      for (const l of langs) {
        const est = await mod.Speech.estimate({ store: e.store, lang: l, voice: voiceFor(l) }).catch(() => null);
        if (est?.fits === false && l === hooks.lang()) return { error: est.reason || 'device-unsupported' };
        if (est) bytes += est.missingBytes ?? est.downloadBytes ?? 0;
      }
      if (mode === 'conversation') {
        const am = await hooks.kit.asr();
        const model = am.pickModel ? await am.pickModel() : undefined;
        const est = await am.SpeechToText.estimate({ store: e.store, ...(model ? { model } : {}) }).catch(() => null);
        if (est?.fits === false) return { error: est.reason || 'device-unsupported' };
        if (est) bytes += est.missingBytes ?? est.downloadBytes ?? 0;
      }
    } catch (err) { console.warn('[voice] estimate', err); }
    const c = hooks.chatModel?.() || { missing: false, bytes: 0 };
    return { voice: bytes, chat: c.missing ? c.bytes : 0 };
  }

  // ---------- The microphone ----------
  let mic = null;
  const ep = createEndpointer({ silenceMs: settings.pauseMs });
  let partialTimer = 0, partialBusy = false, lastLang = null;
  async function openMic() {
    if (mic) return;
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no-audio'), { code: 'no-audio' });
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (err) {
      const code = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'mic-denied' : err?.name === 'NotFoundError' ? 'mic-missing' : 'no-audio';
      throw Object.assign(new Error(code), { code });
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    const ac = new Ctx();
    try { await ac.resume(); } catch { /* resumes on the next gesture */ }
    const srcNode = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    srcNode.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const m = { stream, ac, srcNode, analyser, buf, node: null, closed: false };
    const onSamples = (x) => { if (!m.closed) samples(resampleTo16k(x, ac.sampleRate)); };
    try {
      await ac.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
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
    mic = m;
    ep.reset();
    debug.mic = 'open';
    try { debug.micSettings = stream.getAudioTracks()[0].getSettings(); } catch { /* — */ }
  }
  function closeMic() {
    clearInterval(partialTimer); partialTimer = 0;
    const m = mic; mic = null;
    if (!m) return;
    m.closed = true;
    try { m.node?.disconnect(); m.srcNode.disconnect(); } catch { /* gone */ }
    m.stream.getTracks().forEach((t) => t.stop());
    try { m.ac.close(); } catch { /* closed */ }
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
  function samples(x) {
    if (state.mode !== 'conversation' || state.phase === 'paused') return;
    for (const e of ep.push(x)) {
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
  const botSource = {
    level() {
      const p = tts.playing;
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
    player.src = u;
    player.play().catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(u), 1000));
  }
  const speakingModes = () => state.mode === 'speaker' || state.mode === 'conversation';
  function ttsReset() { ttsStop(); tts.lang = null; }
  function ttsStop() {
    tts.gen++;
    tts.ctl?.abort(); tts.ctl = null;
    for (const it of tts.items) if (it.url) URL.revokeObjectURL(it.url);
    tts.items = [];
    if (tts.playing?.url) URL.revokeObjectURL(tts.playing.url);
    tts.playing = null;
    try { player.pause(); player.removeAttribute('src'); player.load(); } catch { /* — */ }
    caption = ''; render();
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
    if (!tts.playing && !tts.items.length) { log('audio-idle'); dispatch({ type: 'AUDIO_IDLE' }); }
  }
  player.addEventListener('ended', () => { if (tts.playing) endOfSentence(tts.playing); });
  player.addEventListener('error', () => { if (tts.playing) endOfSentence(tts.playing); });

  // ---------- The answer, as the chat writes it ----------
  const chunkers = new WeakMap();
  /** The text of one step of the answer so far (`final` when the step is over). */
  function answer(key, text, final = false) {
    if (!speakingModes() || state.phase === 'off' || !key) return;
    if (state.mode === 'conversation' && !['thinking', 'speaking'].includes(state.phase)) return;
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
  function turnStarted() { log('turn-start'); dispatch({ type: 'TURN_START' }); }
  async function turnEnded({ msg = null } = {}) {
    if (msg) answer(msg, msg.content || '', true);
    log('turn-end');
    const speaking = !!(tts.items.length || tts.playing);
    dispatch({ type: 'TURN_END', speaking });
    if (policy === 'turns' && holdForTurn) {
      holdForTurn = false;
      if (!speakingModes()) return;
      if (tts.items.length) await hooks.unloadLlm().catch(() => {});
      if (state.mode === 'conversation') {
        try { await loadAsr(); if (!['paused', 'error', 'off'].includes(state.phase)) await openMic(); } catch (err) { dispatch({ type: 'FAILED', error: err?.code || 'failed' }); }
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
        const need = await missing(mode);
        if (need.error) throw Object.assign(new Error(need.error), { code: need.error });
        if (!settings.seen || need.voice > 0 || (mode === 'conversation' && need.chat > 0)) {
          const yes = await consent(mode, need);
          if (!yes) { setMode('text'); return; }
          settings.seen = true; keep();
          if (need.chat > 0) hooks.approveChatModel?.();
        }
        if (state.mode !== mode) return;
        loadPct = null; render();
        if (policy === 'turns' && hooks.turnRunning()) return;     // a phone loads the voice when the answer is over
        if (mode === 'conversation') {
          await openMic();                        // the permission question first: it is the one the user must answer
          if (policy === 'turns') await hooks.unloadLlm().catch(() => {});
          await Promise.all([loadAsr(), loadSpeech(hooks.lang()).catch((e) => console.warn('[voice] voice', e))]);
        } else {
          await loadSpeech(hooks.lang()).catch((e) => console.warn('[voice] voice', e));
        }
        if (state.mode !== mode) { if (mode === 'conversation' && state.mode !== 'conversation') closeMic(); return; }
        loadPct = null;
        dispatch({ type: 'READY' });
      } catch (err) {
        console.warn('[voice] prepare', err);
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
        case 'mic.end': { stopPartials(); const r = ep.end(); if (r?.type === 'end') dispatch({ type: 'SPEECH_END', audio: r.audio }); else dispatch({ type: 'SPEECH_DROP' }); break; }
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
    if (mode !== 'text') unlockAudio();
    settings.mode = mode === 'conversation' ? settings.mode : mode;
    if (mode !== 'conversation') { settings.mode = mode; keep(); }
    minimized = false;
    if (mode !== 'conversation' && state.mode === 'conversation') disposeIfIdle();
    dispatch({ type: 'MODE', mode });
  }
  // The models stay while the speaker is on; leaving every voice mode lets them go.
  function disposeIfIdle() { setTimeout(() => { if (state.mode === 'text') disposeModels(); else if (state.mode === 'speaker' && asr) { const a = asr; asr = null; a.task.dispose?.(); } }, 0); }

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
    const group = document.createElement('div');
    group.className = 'vp-modes'; group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', 'voice-pop-h');
    for (const m of MODES) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vp-mode'; b.dataset.mode = m;
      b.setAttribute('role', 'radio');
      const on = state.mode === m;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#${ICON[m]}"/></svg><span class="vp-name"></span><span class="vp-line"></span><span class="vp-tick" aria-hidden="true"></span>`;
      b.querySelector('.vp-name').textContent = W.modes[m][0];
      b.querySelector('.vp-line').textContent = W.modes[m][1];
      b.addEventListener('click', () => { closePop(false); setMode(m); if (m !== 'conversation') chip.focus({ preventScroll: true }); });
      b.addEventListener('keydown', (e) => {
        const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!k) return;
        e.preventDefault();
        const all = [...group.querySelectorAll('.vp-mode')];
        all[(all.indexOf(b) + k + all.length) % all.length].focus();
      });
      group.append(b);
    }
    const sets = document.createElement('div');
    sets.className = 'vp-settings';
    const sh = document.createElement('h3'); sh.className = 'vp-sub'; sh.textContent = W.settings;
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
    sets.append(sh, field(W.voiceEs, voiceSelect('es')), field(W.voiceEn, voiceSelect('en')),
      field(W.speed, speedIn, speedOut), pauseRow, autoRow);
    const fine = document.createElement('p'); fine.className = 'vp-fine'; fine.textContent = W.onDevice;
    pop.append(head, fine, group, sets);
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
  q('.vs-orb-btn').addEventListener('click', () => dispatch({ type: 'TAP' }));
  q('.vs-send').addEventListener('click', () => dispatch({ type: 'SEND', text: heard }));
  q('.vs-discard').addEventListener('click', () => { heard = ''; dispatch({ type: 'DISCARD' }); });
  q('.vs-pause').addEventListener('click', () => {
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
    const heardLine = ph === 'hearing' ? partial : ['transcribing', 'review', 'thinking', 'speaking'].includes(ph) ? heard : '';
    q('.vs-heard').textContent = heardLine;
    q('.vs-heard').classList.toggle('is-partial', ph === 'hearing');
    q('.vs-caption').textContent = ph === 'speaking' ? caption : '';
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
  function consent(mode, need) {
    return new Promise((resolve) => {
      const W = w();
      const d = document.createElement('dialog');
      d.className = 'voice-consent';
      d.setAttribute('aria-labelledby', 'vc-h');
      const total = (need.voice || 0) + (mode === 'conversation' ? need.chat || 0 : 0);
      const size = total > 0 ? formatBytes(total, hooks.lang()) : '';
      d.innerHTML = `<div class="vc-orb" aria-hidden="true"></div><h2 id="vc-h"></h2><p class="vc-body"></p><p class="vc-mic"></p><p class="vc-size"></p><div class="vc-actions"><button type="button" class="vs-btn vc-no"></button><button type="button" class="btn vc-go"></button></div>`;
      d.querySelector('h2').textContent = W.consentTitle[mode];
      d.querySelector('.vc-body').textContent = W.consentBody[mode];
      const micP = d.querySelector('.vc-mic');
      if (mode === 'conversation') micP.textContent = W.consentMic; else micP.remove();
      const sz = d.querySelector('.vc-size');
      const lines = [need.voice > 0 ? W.consentSize(formatBytes(need.voice, hooks.lang())) : '', mode === 'conversation' && need.chat > 0 ? W.consentChat(formatBytes(need.chat, hooks.lang())) : ''].filter(Boolean);
      if (lines.length) sz.textContent = lines.join(' '); else sz.remove();
      d.querySelector('.vc-no').textContent = W.consentNo;
      d.querySelector('.vc-go').textContent = W.consentGo(size);
      let answered = false;
      const end = (yes) => { if (answered) return; answered = true; d.close(); d.remove(); resolve(yes); };
      d.querySelector('.vc-go').addEventListener('click', () => { unlockAudio(); end(true); });
      d.querySelector('.vc-no').addEventListener('click', () => end(false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); end(false); });
      d.addEventListener('click', (e) => { if (e.target === d) end(false); });
      document.body.append(d);
      d.showModal();
      d.querySelector('.vc-go').focus();
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
