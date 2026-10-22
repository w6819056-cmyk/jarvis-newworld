import type { AssemblySoundTier } from './assembly-sequence';

interface AudioParamLike {
  setValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
}

interface OscillatorLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: AudioParamLike;
  start(time?: number): void;
  stop(time?: number): void;
}

interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface AssemblyAudioContext {
  readonly currentTime: number;
  readonly state: AudioContextState;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export interface AssemblyVoice {
  frequency: number;
  waveform: OscillatorType;
  gain: number;
}

export interface AssemblySoundProfile {
  durationSeconds: number;
  voices: readonly AssemblyVoice[];
}

export function getAssemblySoundProfile(tier: AssemblySoundTier): AssemblySoundProfile {
  if (tier === 'small') {
    return { durationSeconds: 0.075, voices: [{ frequency: 980, waveform: 'triangle', gain: 0.045 }] };
  }
  return {
    durationSeconds: 0.32,
    voices: [
      { frequency: 392, waveform: 'sine', gain: 0.075 },
      { frequency: 587, waveform: 'sine', gain: 0.055 },
      { frequency: 784, waveform: 'triangle', gain: 0.035 },
    ],
  };
}

export class AssemblyAudio {
  private readonly createContext: () => AssemblyAudioContext;
  private context: AssemblyAudioContext | undefined;

  constructor(createContext: () => AssemblyAudioContext = () => new AudioContext() as unknown as AssemblyAudioContext) {
    this.createContext = createContext;
  }

  async unlock(): Promise<void> {
    try {
      const context = this.getContext();
      if (context?.state === 'suspended') await context.resume();
    } catch {
      // Audio is optional and must never block gesture capture or assembly.
    }
  }

  async play(tier: AssemblySoundTier): Promise<void> {
    try {
      const context = this.getContext();
      if (!context) return;
      if (context.state === 'suspended') await context.resume();
      if (context.state !== 'running') return;

      const profile = getAssemblySoundProfile(tier);
      const now = context.currentTime;
      for (const voice of profile.voices) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = voice.waveform;
        oscillator.frequency.setValueAtTime(voice.frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(voice.frequency * (tier === 'small' ? 0.74 : 0.985), now + profile.durationSeconds);
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(voice.gain, now + Math.min(0.014, profile.durationSeconds * 0.15));
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + profile.durationSeconds);
        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + profile.durationSeconds + 0.01);
      }
    } catch {
      // Audio is optional and must never block gesture capture or assembly.
    }
  }

  private getContext(): AssemblyAudioContext | undefined {
    if (this.context) return this.context;
    this.context = this.createContext();
    return this.context;
  }
}
