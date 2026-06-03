/**
 * Procedural dice audio — no MP3/OGG assets. Web Audio API synthesises a
 * short two-component "clack" on demand:
 *
 *   1. A band-passed noise burst (~3 kHz) for the high-frequency tick that
 *      reads as bone or polished resin hitting wood.
 *   2. A short sine pulse (~110 Hz, falling) for the body thunk that gives
 *      the click weight without becoming a thump.
 *
 * Why procedural:
 *   The rest of the project paints dice faces / pips on canvas rather than
 *   shipping image assets, and audio assets have the same trade-offs (extra
 *   network request, license question, format fragmentation). A ~100-line
 *   synth gives us a satisfying clack and stays in the spirit of the codebase.
 *
 * Two browser constraints we have to respect:
 *
 *   - **Autoplay policy.** AudioContext starts in `suspended` state until a
 *     user gesture resumes it. `ensureInit()` must be called from inside a
 *     click / pointerdown / keydown handler (the Roll button qualifies).
 *
 *   - **Cost of many simultaneous notes.** Multiple dice hitting the floor
 *     in the same frame would spawn N short sources, none of them audibly
 *     distinct. We throttle to one clack per `MIN_GAP_MS`; rapid impacts
 *     just sound like a denser shake, which matches the visual.
 */

const MIN_GAP_MS = 35;
const MASTER_GAIN = 0.4;

class DiceAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = false;
  private lastPlayAtMs = 0;

  /** Wire the Settings toggle through to here. Cheap; no side effects. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // If a user disables sound mid-roll, immediately mute by gating any
    // pending plays — we don't need to tear down the context.
  }

  /**
   * Create the AudioContext on first call. MUST be invoked from inside a
   * user-gesture handler (Roll button click). After init, subsequent calls
   * are a no-op so it's safe to call defensively.
   */
  ensureInit(): void {
    if (this.ctx) {
      // If the context was suspended by the OS / tab switch, resume it.
      // resume() is itself only effective from a user-gesture handler, but
      // we're always called from one.
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
            (
              window as unknown as {
                webkitAudioContext?: typeof AudioContext;
              }
            ).webkitAudioContext);
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch {
      // Some embedded browsers throw on construction — degrade silently.
      return;
    }
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = MASTER_GAIN;
    this.masterGain.connect(this.ctx.destination);
  }

  /**
   * Play one dice clack. `intensity` ∈ (0, 1] scales volume and brightness
   * so harder impacts sound sharper. Throttled — calls inside MIN_GAP_MS of
   * the previous play are silently dropped.
   */
  playClack(intensity = 1): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - this.lastPlayAtMs < MIN_GAP_MS) return;
    this.lastPlayAtMs = nowMs;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const i = Math.min(1, Math.max(0.2, intensity));

    // --- High-frequency tick: filtered noise burst -----------------------
    const noiseBuf = makeNoiseBuffer(ctx, 0.05);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2800 + Math.random() * 1200;
    bp.Q.value = 4 + i * 4; // harder hits → brighter, narrower band

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(i * 0.55, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    noiseSrc.connect(bp).connect(noiseGain).connect(this.masterGain);
    noiseSrc.start(t);
    noiseSrc.stop(t + 0.08);

    // --- Low-frequency thunk: brief falling sine -------------------------
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const baseFreq = 100 + Math.random() * 40;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, t + 0.05);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(i * 0.32, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(oscGain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }
}

function makeNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // White noise with a linear fade so the burst lands as a percussive
    // tick rather than a sustained hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  return buf;
}

/** Module-level singleton — there's exactly one set of speakers. */
export const diceAudio = new DiceAudio();
