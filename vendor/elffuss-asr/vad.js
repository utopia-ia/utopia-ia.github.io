// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Voice activity in this browser: Silero VAD v5 (the Silero Team, MIT; the ONNX export of onnx-community, 2.2 MB) on
// ONNX Runtime Web's processor backend, in its own Worker, through the elffuss-ai SDK core (Task, model store,
// integrity) with its pinned entry in registry.json. The chat's voice mode feeds it the microphone at 16 kHz in frames
// of 512 samples and gets the probability that each one is speech (voice-core.js turns that into the end of what was
// said). It keeps its recurrent state between calls; reset() starts it again (a new microphone).
//
//   const vad = new VoiceActivity({ store, runtime, registry });
//   const probs = await vad.run(frames512xN);          // Float32Array, one probability per frame
//   await vad.run(new Float32Array(0), { reset: true });
import { Task } from '../elffuss-ai/sdk/core/task.js';
import { getModel, defaultModelId, variantFiles } from '../elffuss-ai/sdk/core/registry.js';

export const FRAME = 512;

export class VoiceActivity extends Task {
  /** @param {import('../elffuss-ai/sdk/core/task.js').TaskOptions & { registry: object }} options */
  constructor(options) {
    super({
      task: 'voice-activity',
      workerUrl: new URL('./vad-worker.js', import.meta.url),
      impl: () => import('./vad-impl.js'),
      prepare: async (input) => ({ value: input, transfer: [input.buffer] }),
    }, { device: 'wasm', ...options });
  }

  /** What it would download here (2.2 MB once), nothing downloaded. */
  static async estimate({ store, registry }) {
    const m = getModel(registry, defaultModelId(registry, 'voice-activity'));
    const files = variantFiles(m, m.devices.wasm[0]);
    const downloadBytes = files.reduce((s, f) => s + f.size, 0);
    let missingBytes = downloadBytes;
    if (store) { try { const has = await Promise.all(files.map((f) => store.has(f.url, f.size))); missingBytes = files.reduce((s, f, i) => s + (has[i] ? 0 : f.size), 0); } catch { /* count it all */ } }
    return { fits: true, reason: null, device: 'wasm', downloadBytes, missingBytes };
  }
}
