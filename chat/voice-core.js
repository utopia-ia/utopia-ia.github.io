// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The pure parts of the chat's voice mode (voice.js), with no DOM and no audio device, so they run in Node's tests too:
//
//   createEndpointer(opts)   voice activity and the end of what was said: energy against a noise floor that follows
//                            the room, a hangover of silence (`silenceMs`, 800 ms by default) before «done»
//   speakable(text)          what of an answer is read aloud: no code, no tool calls, no addresses, no markdown marks
//   createChunker(opts)      an answer that is still being written, cut into sentences to read one by one
//   textLang(text)           Spanish or English, from the words
//   isHallucination(text)    what Whisper writes when it hears nothing («Subtítulos realizados por…»)
//   pickLanguage(scores)     Whisper's language scores with the page's language as a prior
//   reduce(state, event)     the modes (text, speaker, conversation) and the phases of a conversation, as a reducer
//                            that says what to do (effects) and never does it
//   parseWav(buffer)         the samples of a 16-bit PCM WAV (what the speech models give)

// ---------- Voice activity and end of utterance ----------
export const RATE = 16000;
export const ENDPOINT_DEFAULTS = Object.freeze({
  frameMs: 20,
  silenceMs: 800,        // «pausa para terminar»: this much quiet after speech ends the utterance
  onsetMs: 120,          // this much voice in a row starts one (a click or a cough is shorter)
  minSpeechMs: 300,      // shorter than this, it was not something said: dropped
  preRollMs: 300,        // kept from before the onset, so the first syllable is not cut
  maxMs: 28000,          // Whisper reads 30 s at a time: past this the utterance is ended
  marginDb: 10,          // above the noise floor by this much is voice
  holdDb: 4,             // once speaking, a frame this much under the margin still counts (hysteresis)
  minDb: -52,            // never voice below this, whatever the floor
  bargeMarginDb: 18,     // while the answer is being read: louder than the floor by this much…
  bargeOnsetMs: 260,     // …and for this long, to interrupt it (its own voice leaking back is not the user)
  echoMarginDb: 10,      // with the answer's level known (setReference): louder than its echo by this much
});

/** Loudness of a frame in dBFS. */
export function frameDb(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, x.length) + 1e-12);
}

/**
 * Voice activity with an end-of-utterance detector, on mono samples at 16 kHz. push() takes any number of samples and
 * returns what happened in them: { type: 'start' } when an utterance begins (after `onsetMs` of voice), { type: 'end',
 * audio, ms, reason } when it ends (`silenceMs` of quiet, `maxMs`, or end()), { type: 'drop', ms } for one too short.
 * `level` is the last frame's loudness from 0 to 1. setBargeIn(true) makes it harder to start (the answer is playing).
 */
export function createEndpointer(options = {}) {
  const o = { ...ENDPOINT_DEFAULTS, ...options };
  const frameLen = Math.round((RATE * o.frameMs) / 1000);
  const ms = (frames) => frames * o.frameMs;
  const pre = [];                       // the frames before an onset (pre-roll and the onset itself)
  const preMax = Math.ceil((o.preRollMs + o.bargeOnsetMs) / o.frameMs);
  let carry = new Float32Array(0);
  let floor = -60;                      // the room's noise, in dB
  let floorSeen = 0;                    // frames that taught the floor (the first ones learn faster)
  let speaking = false, run = 0, quiet = 0, voiced = 0;
  let out = [];                         // frames of the utterance
  let barge = false;
  let level = 0, lastDb = -100;
  // The answer's own voice at the playhead (dB), when it plays: its echo at the microphone sits a roughly constant
  // `coupling` below or above it. That coupling is learnt while the answer plays (down fast, up slowly), and only a
  // voice clearly louder than the echo it explains counts as the user. Measured with the real voice and the real
  // microphone settings (tests/voice-echo.mjs): without it, an echo above about -36 dBFS interrupted the answer.
  let reference = null, coupling = null;

  const margin = () => (barge ? o.bargeMarginDb : o.marginDb);
  const onset = () => Math.round((barge ? o.bargeOnsetMs : o.onsetMs) / o.frameMs);

  function finish(reason) {
    const frames = out;
    out = []; speaking = false; run = 0; quiet = 0;
    const said = voiced; voiced = 0;
    // Trailing silence beyond a short tail is not kept.
    const keepTail = Math.round(200 / o.frameMs);
    const cut = reason === 'silence' ? Math.max(0, frames.length - Math.max(0, Math.round(o.silenceMs / o.frameMs) - keepTail)) : frames.length;
    const used = frames.slice(0, cut);
    if (ms(said) < o.minSpeechMs) return { type: 'drop', ms: ms(said) };
    const audio = new Float32Array(used.length * frameLen);
    used.forEach((f, i) => audio.set(f, i * frameLen));
    return { type: 'end', audio, ms: ms(used.length), reason };
  }

  function frame(f, events) {
    const db = frameDb(f);
    lastDb = db;
    level = Math.min(1, Math.max(0, (db + 60) / 50));
    let loud = db > Math.max(o.minDb, floor + margin());
    if (barge && reference) {
      const ref = reference();
      if (ref > -70) {
        const d = db - ref;
        // It starts as loud as the answer itself (no echo cancellation, the speaker by the microphone) and comes down
        // to what is heard: a frame with sound says the echo is that loud; a quiet one, that it is at most the room.
        if (coupling == null) coupling = 0;
        const seen = db > floor + 6 ? d : floor + 6 - ref;
        coupling += (seen < coupling ? 0.2 : 0.02) * (seen - coupling);
        if (d < coupling + o.echoMarginDb) loud = false;
      }
    }
    if (!speaking) {
      // The floor follows the room while nobody speaks: down at once, up slowly (a voice does not raise it).
      if (!loud || floorSeen < 10) {
        const a = floorSeen < 25 ? 0.25 : db < floor ? 0.2 : 0.015;
        floor += a * (db - floor);
        floor = Math.min(-28, Math.max(-80, floor));
        floorSeen++;
      }
      pre.push(f);
      if (pre.length > preMax) pre.shift();
      // While the answer plays the count leaks instead of resetting: one frame that the echo gate doubts does not
      // throw away a user who is clearly talking over it.
      run = loud ? run + 1 : barge && reference ? Math.max(0, run - 1) : 0;
      if (run >= onset()) {
        speaking = true; quiet = 0; voiced = run;
        const keep = Math.min(pre.length, run + Math.round(o.preRollMs / o.frameMs));
        out = pre.slice(pre.length - keep);
        pre.length = 0;
        events.push({ type: 'start', db });
      }
      return;
    }
    out.push(f);
    const still = db > Math.max(o.minDb, floor + o.marginDb - o.holdDb);
    if (still) { quiet = 0; voiced++; } else quiet++;
    if (ms(quiet) >= o.silenceMs) events.push(finish('silence'));
    else if (ms(out.length) >= o.maxMs) events.push(finish('max'));
  }

  return {
    get level() { return level; },
    get db() { return lastDb; },
    get floor() { return floor; },
    get speaking() { return speaking; },
    get options() { return { ...o }; },
    set(opts) { Object.assign(o, opts); },
    setBargeIn(on) { barge = !!on; if (!on) coupling = null; },
    /** `fn()` gives the level (dBFS) of the answer playing now, or -100: its echo is then not taken for the user. */
    setReference(fn) { reference = fn || null; },
    get coupling() { return coupling; },
    /** The utterance so far (for a partial transcript), or null. */
    current() {
      if (!speaking || !out.length) return null;
      const a = new Float32Array(out.length * frameLen);
      out.forEach((f, i) => a.set(f, i * frameLen));
      return a;
    },
    push(samples) {
      const events = [];
      let x = samples;
      if (carry.length) { x = new Float32Array(carry.length + samples.length); x.set(carry); x.set(samples, carry.length); }
      let i = 0;
      for (; i + frameLen <= x.length; i += frameLen) frame(x.slice(i, i + frameLen), events);
      carry = x.slice(i);
      return events;
    },
    /** End now (a tap on the orb): the utterance as it is, or nothing. */
    end() { return speaking ? finish('tap') : null; },
    reset() { speaking = false; run = 0; quiet = 0; voiced = 0; out = []; pre.length = 0; carry = new Float32Array(0); },
  };
}

/** Samples at `from` Hz to 16 kHz (box filter then linear interpolation: enough for speech). */
export function resampleTo16k(x, from) {
  if (from === RATE) return Float32Array.from(x);
  const ratio = from / RATE;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  const half = Math.max(0, Math.floor(ratio / 2));
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    const k = Math.floor(c);
    let s = 0, m = 0;
    for (let j = k - half; j <= k + half; j++) if (j >= 0 && j < x.length) { s += x[j]; m++; }
    out[i] = m ? s / m : 0;
  }
  return out;
}

// ---------- What is read aloud ----------
const TOOL_START = /```(?:tool|json|html)?\s*\{?\s*"?tool"?|<tool_call>|<function[\s=>]|\{\s*"tool"\s*:|<!doctype html|<html[\s>]/i;

/** The part of an answer a voice reads: no code, no tool calls, no addresses, no markdown marks. */
export function speakable(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  const t = TOOL_START.exec(s);
  if (t) s = s.slice(0, t.index);
  // Code blocks (closed or still open) are not read.
  s = s.replace(/```[\s\S]*?(```|$)/g, ' ');
  // Tables: not read.
  s = s.split('\n').filter((l) => !/^\s*\|.*\|\s*$/.test(l) && !/^\s*\|?\s*:?-{3,}/.test(l)).join('\n');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                       // images
  s = s.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1');                 // links: their words
  s = s.replace(/<https?:[^>]+>/g, '');
  s = s.replace(/\bhttps?:\/\/[^\s)»"]+/g, '');                     // bare addresses
  s = s.replace(/\b(?:img|aud|vid)-[a-z0-9]{3,}\b/gi, '');           // media ids
  s = s.replace(/`([^`\n]*)`/g, '$1');
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gm, '$1.');                  // headings end a sentence
  s = s.replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, '');                  // list marks
  s = s.replace(/^[ \t]*>[ \t]?/gm, '');
  s = s.replace(/(\*\*|__|~~)(.*?)\1/g, '$2').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2');
  s = s.replace(/<[^>]{1,40}>/g, '');
  s = s.replace(/[*#_~`|]+/g, ' ');
  s = s.replace(/\.{2,}\./g, '…');
  return s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\.\.$/, '.').trim();
}

const ABBR = /(?:\b(?:sr|sra|srta|dr|dra|d|dña|ud|uds|vd|etc|p\.?\s?ej|e\.g|i\.e|vs|approx|aprox|núm|nº|pág|tel|av|avda|mr|mrs|ms|st|no|fig|cap|art)|\b[A-Z])\.$/i;

/**
 * Sentences of an answer that is still being written: push(full text so far) returns the sentences that are now
 * complete and were not given before; flush() the rest when the answer ends. A short first sentence goes at once (the
 * first sound matters most); later short ones wait to join the next, and a long one is cut at a comma.
 */
export function createChunker({ minChars = 28, firstMinChars = 2, maxChars = 240, firstMaxChars = 80 } = {}) {
  let done = 0;            // characters of speakable(text) already given
  let given = 0;
  const cut = (s, final) => {
    const out = [];
    let start = 0;
    const re = /([.!?…]+)(["'»”)\]]*)(\s+|$)|\n+/g;
    let m;
    while ((m = re.exec(s))) {
      const end = m.index + m[0].length;
      if (!final && end >= s.length && !m[0].includes('\n') && !/\s$/.test(m[0])) break; // the text may go on («3.5»)
      const piece = s.slice(start, end);
      const body = piece.trim();
      if (!body) { start = end; continue; }
      if (m[1] && ABBR.test(s.slice(Math.max(0, start), m.index + m[1].length))) continue;
      if (m[1] && /\d$/.test(s.slice(0, m.index)) && /^\d/.test(s.slice(end))) continue;
      const need = given + out.length === 0 ? firstMinChars : minChars;
      if (body.length < need && end < s.length) continue;     // too short: joins the next one
      out.push(body);
      start = end;
    }
    const rest = s.slice(start);
    if (final && rest.trim()) out.push(rest.trim());
    return { out, used: final ? s.length : start };
  };
  const split = (list) => {
    const res = [];
    for (const x of list) {
      let s = x;
      // The very first piece is what the user waits for: a long first sentence is read in two (at a comma, else at a
      // word past the middle). Measured with MOSS on WebGPU while the chat model writes: about 0.75 s per second of
      // voice, so a 110-character first sentence kept the user waiting 5 s.
      if (given + res.length === 0 && s.length > firstMaxChars) {
        const room = s.slice(0, firstMaxChars);
        const c = Math.max(room.lastIndexOf(', '), room.lastIndexOf('; '), room.lastIndexOf(': '));
        const k = c >= 20 ? c + 1 : room.lastIndexOf(' ') >= firstMaxChars / 2 ? room.lastIndexOf(' ') : -1;
        if (k > 0) { res.push(s.slice(0, k).trim()); s = s.slice(k).trim(); }
      }
      while (s.length > maxChars) {
        const room = s.slice(0, maxChars);
        const at = Math.max(room.lastIndexOf(', '), room.lastIndexOf('; '), room.lastIndexOf(': '), room.lastIndexOf(' — '));
        const k = at > maxChars / 3 ? at + 1 : room.lastIndexOf(' ') > 0 ? room.lastIndexOf(' ') : maxChars;
        res.push(s.slice(0, k).trim());
        s = s.slice(k).trim();
      }
      if (s) res.push(s);
    }
    return res.filter((r) => /[\p{L}\p{N}]/u.test(r));
  };
  const step = (text, final) => {
    // A space at the end of what was written says the last word is over («3.» then « » is a sentence; «3.» alone may be 3.5).
    const s = speakable(text) + (/\s$/.test(String(text || '')) ? ' ' : '');
    if (s.length < done) done = Math.min(done, s.length);    // the text was cut back (a tool call found): never repeat
    const { out, used } = cut(s.slice(done), final);
    done += used;
    const r = split(out);
    given += r.length;
    return r;
  };
  return { push: (text) => step(text, false), flush: (text) => step(text, true), get offset() { return done; } };
}

const ES_HINTS = /[ñ¿¡áéíóú]|\b(el|la|los|las|que|de|del|y|en|es|un|una|por|para|con|no|se|lo|su|al|como|más|pero|está|hola|gracias|sí)\b/gi;
const EN_HINTS = /\b(the|and|is|are|of|to|in|that|it|you|for|with|on|this|be|have|not|was|what|hello|thanks|yes)\b/gi;
/** 'es' or 'en' from the words of a text; `fallback` when it cannot tell. */
export function textLang(text, fallback = 'es') {
  const s = String(text || '');
  const es = (s.match(ES_HINTS) || []).length, en = (s.match(EN_HINTS) || []).length;
  if (es === en) return fallback;
  return es > en ? 'es' : 'en';
}

// What Whisper writes over silence or noise, learnt from its subtitles. Only a transcript that is nothing else is dropped.
const HALLUCINATIONS = [
  /^(¡?gracias( por (ver|vernos|mirar|su atención))?( el (v[ií]deo|video))?[.!]*\s*)+$/i,
  /subt[ií]tulos? (realizados? |hechos? )?por/i, /amara\.org/i, /^¡?suscr[ií]bete/i,
  /^(thank you( (so much|very much))?( for watching)?[.!]*\s*)+$/i, /^thanks for watching/i, /^please subscribe/i,
  /^(\.|…|-|\s|music|música|\[.*\]|\(.*\))*$/i,
];
/** Whisper's words over silence: true when the whole transcript is one of them. */
export function isHallucination(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  return HALLUCINATIONS.some((r) => r.test(s));
}

/**
 * The language from Whisper's scores (logits of its language tokens), the page's language counted as a prior: it
 * wins unless the other is clearly ahead. { es: 23.5, en: 17.8 }, 'en' → 'es'.
 */
export function pickLanguage(scores, prior = 'es', bonus = 1.5) {
  const keys = Object.keys(scores || {}).filter((k) => Number.isFinite(scores[k]));
  if (!keys.length) return prior;
  let best = null, bestV = -Infinity;
  for (const k of keys) { const v = scores[k] + (k === prior ? bonus : 0); if (v > bestV) { bestV = v; best = k; } }
  return best;
}

// ---------- Modes and phases ----------
export const MODES = ['text', 'speaker', 'conversation'];
export const initialState = Object.freeze({ mode: 'text', phase: 'off', turnDone: true, queued: 0, error: null });

/**
 * The voice mode as a reducer: (state, event) → { state, effects }. It decides; voice.js does what the effects say.
 * Events: { type: 'MODE', mode } · 'READY' · 'FAILED' {error} · 'SPEECH_START' · 'SPEECH_END' {audio} · 'SPEECH_DROP' ·
 * 'TRANSCRIPT' {text} · 'SEND' · 'DISCARD' · 'TURN_START' · 'TURN_END' · 'AUDIO_START' · 'AUDIO_IDLE' · 'TAP' ·
 * 'USER_TYPED' · 'STOP_PRESSED' · 'HIDDEN'.
 * Effects (strings or { type, … }): 'prepare' (download and load what the mode needs, then READY), 'mic.open',
 * 'mic.close', 'mic.pause', 'mic.resume', 'mic.end' (end the utterance now), 'barge.on'/'barge.off', 'asr.final'
 * {audio}, 'asr.cancel', 'send', 'tts.reset', 'tts.stop', 'turn.stop'.
 */
export function reduce(state, ev) {
  const s = { ...state };
  const fx = [];
  const to = (phase) => { s.phase = phase; };
  const interrupt = () => { fx.push('tts.stop'); if (!s.turnDone) fx.push('turn.stop'); s.turnDone = true; s.queued = 0; };
  switch (ev.type) {
    case 'MODE': {
      const m = MODES.includes(ev.mode) ? ev.mode : 'text';
      if (m === s.mode) return { state: s, effects: [] };
      if (s.mode === 'conversation') { fx.push('asr.cancel', 'mic.close'); }
      if (s.mode !== 'text') fx.push('tts.stop');
      s.mode = m; s.error = null; s.queued = 0;
      if (m === 'text') to('off');
      else if (m === 'speaker') { to('idle'); fx.push('prepare'); }
      else { to('loading'); fx.push('prepare'); }
      return { state: s, effects: fx };
    }
    case 'READY':
      if (s.mode === 'conversation' && (s.phase === 'loading' || s.phase === 'error')) { to('listening'); fx.push('mic.open', 'barge.off'); }
      return { state: s, effects: fx };
    case 'FAILED':
      if (s.mode !== 'text') { s.error = ev.error || 'failed'; if (s.mode === 'conversation') { fx.push('mic.close'); to('error'); } else to('idle'); }
      return { state: s, effects: fx };
    case 'SPEECH_START':
      if (s.mode !== 'conversation') break;
      if (s.phase === 'listening') to('hearing');
      else if (s.phase === 'speaking' || s.phase === 'thinking') { interrupt(); fx.push('barge.off'); to('hearing'); }
      break;
    case 'SPEECH_END':
      if (s.mode === 'conversation' && s.phase === 'hearing') { to('transcribing'); fx.push({ type: 'asr.final', audio: ev.audio }); }
      break;
    case 'SPEECH_DROP':
      if (s.mode === 'conversation' && s.phase === 'hearing') to('listening');
      break;
    case 'TRANSCRIPT':
      if (s.mode !== 'conversation' || s.phase !== 'transcribing') break;
      if (!String(ev.text || '').trim()) { to('listening'); break; }
      if (ev.autoSend === false) { to('review'); break; }
      // While it thinks the microphone stays open: talking interrupts, but only a clear voice (barge-in levels).
      to('thinking'); s.turnDone = false; fx.push({ type: 'send', text: ev.text }, 'barge.on');
      break;
    case 'SEND':
      if (s.mode === 'conversation' && s.phase === 'review') { to('thinking'); s.turnDone = false; fx.push({ type: 'send', text: ev.text }, 'barge.on'); }
      break;
    case 'DISCARD':
      if (s.mode === 'conversation' && s.phase === 'review') to('listening');
      break;
    case 'TURN_START':
      s.turnDone = false; s.queued = 0;
      fx.push('tts.reset');
      if (s.mode === 'conversation' && (s.phase === 'listening' || s.phase === 'review')) { to('thinking'); fx.push('barge.on'); }
      break;
    case 'AUDIO_START':
      s.queued = 1;
      if (s.mode === 'speaker' && s.phase === 'idle') to('speaking');
      if (s.mode === 'conversation' && s.phase === 'thinking') { to('speaking'); fx.push('barge.on'); }
      break;
    case 'AUDIO_IDLE':
      s.queued = 0;
      if (s.mode === 'speaker' && s.phase === 'speaking') to('idle');
      if (s.mode === 'conversation' && s.phase === 'speaking') {
        if (s.turnDone) { to('listening'); fx.push('barge.off'); } else to('thinking');
      }
      break;
    case 'TURN_END':
      s.turnDone = true;
      if (s.mode === 'conversation' && s.phase === 'thinking' && !s.queued && !ev.speaking) { to('listening'); fx.push('barge.off'); }
      break;
    case 'TAP':
      if (s.mode !== 'conversation') break;
      if (s.phase === 'hearing') fx.push('mic.end');
      else if (s.phase === 'thinking' || s.phase === 'speaking') { interrupt(); fx.push('barge.off'); to('listening'); }
      else if (s.phase === 'listening') { to('paused'); fx.push('mic.pause'); }
      else if (s.phase === 'paused') { to('listening'); fx.push('mic.resume'); }
      else if (s.phase === 'error') { to('loading'); s.error = null; fx.push('prepare'); }
      break;
    case 'USER_TYPED':
    case 'STOP_PRESSED':
      if (s.mode === 'speaker' && s.phase === 'speaking') { fx.push('tts.stop'); to('idle'); s.queued = 0; }
      if (s.mode === 'conversation' && (s.phase === 'speaking' || s.phase === 'thinking')) { interrupt(); fx.push('barge.off'); to('listening'); }
      break;
    case 'HIDDEN':
      // A hidden tab lets the microphone go (and the answer stops), as a phone expects.
      if (s.mode === 'conversation' && s.phase !== 'paused' && s.phase !== 'loading' && s.phase !== 'error') {
        if (s.phase === 'speaking' || s.phase === 'thinking') interrupt();
        to('paused'); fx.push('mic.pause', 'barge.off');
      }
      break;
    default:
      break;
  }
  return { state: s, effects: fx };
}

// ---------- WAV ----------
/** { rate, samples } of a 16-bit PCM WAV (mono, or the channels averaged), or null. */
export function parseWav(buf) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12, rate = 0, ch = 1, bits = 16, fmt = 1;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') { fmt = v.getUint16(o + 8, true); ch = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === 'data') {
      const end = Math.min(v.byteLength, o + 8 + size);
      const bytes = bits / 8, n = Math.floor((end - o - 8) / (bytes * ch));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) {
          const p = o + 8 + (i * ch + c) * bytes;
          s += fmt === 3 && bits === 32 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : (v.getUint8(p) - 128) / 128;
        }
        out[i] = s / ch;
      }
      return { rate, samples: out };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}
