// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// A voice note written down in this browser: Whisper base through the elffuss-ai SDK core (Task, Worker, model store,
// integrity), with its own pinned registry entry (registry.json). It lives under /vendor/ next to the SDK copy because
// the SDK starts Workers only from there. The same files are in the chat, Claw and Code.
//
//   const asr = new SpeechToText({ store, runtime, onProgress });
//   const { text } = await asr.run(samples16k, { language: 'es', signal });
//   const { text, language } = await asr.run(samples16k, { detect: ['es', 'en'], prior: 'es' });   (the language first)
//   await asr.dispose();
// `model` (MODELS.small, pickModel()) picks another model of registry.json; base by default.
import { Task } from '../elffuss-ai/sdk/core/task.js';
import { getModel, defaultModelId, variantFiles } from '../elffuss-ai/sdk/core/registry.js';
import { probeWebGPU, chooseVariant } from '../elffuss-ai/sdk/core/device.js';

let registryP = null;
/** The pinned registry of this task (whisper-base at one revision of onnx-community/whisper-base). */
export function registry() {
  registryP ||= fetch(new URL('./registry.json', import.meta.url), { credentials: 'same-origin' }).then((r) => {
    if (!r.ok) throw new Error('speech-to-text registry not found');
    return r.json();
  });
  registryP.catch(() => { registryP = null; });
  return registryP;
}

/** Phones read on the processor (the 8-bit model, 80 MB); computers on the graphics card (the 32-bit one). */
export const preferredDevice = () => (globalThis.matchMedia?.('(pointer: coarse)').matches ? 'wasm' : 'auto');

/** The models of registry.json: base (every device) and small (WebGPU with fp32 only: better words, 970 MB). */
export const MODELS = Object.freeze({ base: 'speech-to-text/whisper-base', small: 'speech-to-text/whisper-small' });

/**
 * The model for a live conversation: small where it runs on a graphics card (a computer with WebGPU), base elsewhere
 * (a phone reads on the processor, where small is about 4.6 times slower than base: too slow to talk to).
 */
export async function pickModel({ device = preferredDevice() } = {}) {
  if (device === 'wasm') return MODELS.base;
  try { if ((await probeWebGPU()).available) return MODELS.small; } catch { /* no graphics card */ }
  return MODELS.base;
}

export class SpeechToText extends Task {
  /** @param {import('../elffuss-ai/sdk/core/task.js').TaskOptions & { registry: object }} options */
  constructor(options) {
    super({
      task: 'speech-to-text',
      workerUrl: new URL('./worker.js', import.meta.url),
      impl: () => import('./impl.js'),
      prepare: async (input) => ({ value: input, transfer: [input.buffer] }),
    }, { device: preferredDevice(), ...options });
  }

  /** What a run would download here, before anything is downloaded: { fits, reason, downloadBytes, missingBytes }. */
  static async estimate({ store, device = preferredDevice(), model } = {}) {
    const reg = await registry();
    const m = getModel(reg, model || defaultModelId(reg, 'speech-to-text'));
    let choice;
    try { choice = chooseVariant(m, device, await probeWebGPU()); } catch { return { fits: false, reason: 'device-unsupported', downloadBytes: 0, missingBytes: 0 }; }
    const files = variantFiles(m, choice.variant);
    const downloadBytes = files.reduce((s, f) => s + f.size, 0);
    let missingBytes = downloadBytes;
    if (store) {
      try { const has = await Promise.all(files.map((f) => store.has(f.url, f.size))); missingBytes = files.reduce((s, f, i) => s + (has[i] ? 0 : f.size), 0); } catch { /* count it all */ }
    }
    return { fits: true, reason: null, device: choice.device, downloadBytes, missingBytes };
  }
}
