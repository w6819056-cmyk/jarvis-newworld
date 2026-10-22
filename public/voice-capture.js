// Single microphone owner. AudioContext is explicitly created at 16 kHz.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(1600); this.offset = 0;
    this.voiceGain = 1;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) {
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const rms = Math.sqrt(energy / samples.length);
      // Microphones differ widely in Windows. Raise quiet speech gradually,
      // leave normal speech nearly unchanged, and avoid amplifying silence.
      if (rms > 0.008) {
        const wanted = Math.min(3, 0.06 / rms);
        this.voiceGain += (wanted - this.voiceGain) * 0.18;
      } else {
        this.voiceGain += (1 - this.voiceGain) * 0.12;
      }
      for (const sample of samples) {
        const amplified = sample * this.voiceGain;
        const magnitude = Math.abs(amplified);
        const limited = magnitude <= 0.88 ? magnitude : 0.88 + 0.10 * (1 - Math.exp(-(magnitude - 0.88) / 0.10));
        this.buffer[this.offset++] = Math.sign(amplified) * limited;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(1600); this.offset = 0;
      }
      }
    }
    return true;
  }
}
registerProcessor('jarvis-capture', VoiceCapture);
