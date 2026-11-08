// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Silero VAD v5 where it runs (a Worker): one ONNX Runtime session of onnx/model.onnx, fed by the model store at the
// revision registry.json pins. Each frame is 512 new samples at 16 kHz with the 64 before it (v5 reads 576), and the
// recurrent state (2×1×128) goes from one frame to the next, as the reference implementation does.
import { AiError } from '../elffuss-ai/sdk/core/errors.js';

export const task = 'voice-activity';
const FRAME = 512, CONTEXT = 64;

/** @param {import('../elffuss-ai/sdk/core/task-runtime.js').TaskContext} ctx */
export async function load(ctx) {
  const ort = await ctx.ort();
  const session = await ctx.session('main:onnx/model.onnx');
  return { ort, session, state: new Float32Array(256), context: new Float32Array(CONTEXT), sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []) };
}

/**
 * @param {{ ort: any, session: any, state: Float32Array, context: Float32Array, sr: any }} st
 * @param {Float32Array} input whole frames of 512 samples at 16 kHz
 * @param {{ reset?: boolean }} opts
 */
export async function run(st, input, opts = {}) {
  if (!(input instanceof Float32Array)) throw new AiError('unsupported-format', 'voice activity takes 16 kHz mono samples');
  if (opts.reset) { st.state = new Float32Array(256); st.context = new Float32Array(CONTEXT); }
  const n = Math.floor(input.length / FRAME);
  const probs = new Float32Array(n);
  let state = new st.ort.Tensor('float32', st.state, [2, 1, 128]);
  for (let k = 0; k < n; k++) {
    const x = new Float32Array(CONTEXT + FRAME);
    x.set(st.context);
    x.set(input.subarray(k * FRAME, (k + 1) * FRAME), CONTEXT);
    const out = await st.session.run({ input: new st.ort.Tensor('float32', x, [1, CONTEXT + FRAME]), state, sr: st.sr });
    probs[k] = out.output.data[0];
    state = out.stateN;
    st.context = input.slice((k + 1) * FRAME - CONTEXT, (k + 1) * FRAME);
  }
  st.state = new Float32Array(state.data);
  return { value: probs, transfer: [probs.buffer] };
}

export async function dispose(st) {
  try { await st?.session?.release?.(); } catch { /* releasing */ }
}
