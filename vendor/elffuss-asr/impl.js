// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Speech to text where the model runs (a Worker): Whisper base (OpenAI, Apache-2.0; the ONNX export of
// onnx-community) as a Transformers.js pipeline, fed only by the Elffuss model store at the revision registry.json
// pins (the SDK core's ctx.pipeline()). The language is always given: Whisper without one is told English by
// Transformers.js and translates instead of writing down what was said.
import { AiError } from '../elffuss-ai/sdk/core/errors.js';

export const task = 'speech-to-text';

/** @param {import('../elffuss-ai/sdk/core/task-runtime.js').TaskContext} ctx */
export async function load(ctx) {
  const asr = await ctx.pipeline();
  let tf = null;
  try { tf = await ctx.transformers(); } catch { /* no language detection: the language must be given */ }
  return { asr, tf };
}

/**
 * Whisper's own language scores, for the candidates only: one step of the decoder after <|startoftranscript|>, the
 * logits of each candidate's language token (transformers.js v3 never detects: without a language it says English).
 * Measured on whisper-base: es 23.5 / en 17.8 for Spanish, en 24.1 / es 14.5 for English.
 */
async function languageScores(state, input, candidates) {
  const { asr, tf } = state;
  const gc = asr.model.generation_config || {};
  const ids = gc.lang_to_id || {};
  const want = candidates.filter((c) => ids[`<|${c}|>`] != null);
  if (!tf?.Tensor || !want.length || gc.decoder_start_token_id == null) return null;
  const { input_features } = await asr.processor(input);
  const dec = new tf.Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const out = await asr.model({ input_features, decoder_input_ids: dec });
  const logits = out.logits;
  const vocab = logits.dims.at(-1);
  const last = logits.data.subarray(logits.data.length - vocab);
  const scores = {};
  for (const c of want) scores[c] = Number(last[ids[`<|${c}|>`]]);
  return scores;
}

/** The candidate that scores best, the prior counted as 1.5 logits ahead (voice-core.js pickLanguage). */
function pick(scores, prior) {
  let best = null, bestV = -Infinity;
  for (const [k, v] of Object.entries(scores)) { const x = v + (k === prior ? 1.5 : 0); if (x > bestV) { bestV = x; best = k; } }
  return best;
}

/**
 * @param {{ asr: any, tf: any }} state
 * @param {Float32Array} input mono samples at 16 kHz
 * @param {{ language?: string, detect?: string[], prior?: string, prompt?: string }} opts `language`, or `detect`: the
 *   candidates to tell apart first (the result's `language`), `prior` the one that wins a close call
 */
export async function run(state, input, opts, ctx) {
  if (!(input instanceof Float32Array)) throw new AiError('unsupported-format', 'speech-to-text takes 16 kHz mono samples');
  let language = opts?.language || null, scores = null;
  if (!language && Array.isArray(opts?.detect) && opts.detect.length) {
    ctx.report('running', { stage: 'language' });
    // Under a second there is too little to tell: the prior.
    if (input.length >= 12800) { try { scores = await languageScores(state, input, opts.detect); } catch { scores = null; } }
    language = scores ? pick(scores, opts.prior) : (opts.prior || opts.detect[0]);
  }
  if (!language) throw new AiError('unsupported-format', 'the language is needed');
  ctx.report('running', { stage: 'transcribe' });
  const out = await state.asr(input, { language, task: 'transcribe', temperature: 0, no_repeat_ngram_size: 3, chunk_length_s: 30, stride_length_s: 5 });
  ctx.report('done');
  const text = (Array.isArray(out) ? out.map((x) => x.text).join(' ') : out?.text || '').replace(/\s+/g, ' ').trim();
  return { value: { text, language, ...(scores ? { scores } : {}) } };
}

export async function dispose(state) {
  try { await state?.asr?.dispose?.(); } catch { /* releasing */ }
}
