// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The voice mode's microphone tap (voice.js): an AudioWorklet that hands the samples of the first channel to the page in
// blocks of about 20 ms, at the context's own rate. Nothing is kept here and nothing leaves the page.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(128, Math.round(sampleRate / 50));
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const k = Math.min(ch.length - i, this.size - this.n);
        this.buf.set(ch.subarray(i, i + k), this.n);
        this.n += k; i += k;
        if (this.n === this.size) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
