/**
 * Procedural dice audio — no MP3/OGG assets. Web Audio API synthesises a
 * short three-component "clack" on demand, voiced for resin dice on a
 * wooden tavern table rather than the bright plastic tick the first cut
 * landed on:
 *
 *   1. A damped noise burst centred at ~1.5 kHz for the corner-strike
 *      transient. Low Q so it reads as a knock, not a chime.
 *   2. A short falling sine at ~240 Hz for the body thunk — the woody
 *      mid-range that gives the click weight.
 *   3. A brief sub-thump at ~70 Hz so the impact has floor under it on
 *      good speakers, but stays felt-not-heard on phones.
 *
 * Why procedural:
 *   The rest of the project paints dice faces on canvas rather than
 *   shipping image assets, and audio assets have the same trade-offs
 *   (extra network request, license question, format fragmentation). A
 *   ~100-line synth gives us a satisfying clack and stays in the spirit
 *   of the codebase.
 *
 * Two browser constraints we have to respect:
 *
 *   - **Autoplay policy.** AudioContext starts in `suspended` state until
 *     a user gesture resumes it. `ensureInit()` must be called from
 *     inside a click / pointerdown / keydown handler (Roll button
 *     qualifies).
 *
 *   - **Cost of many simultaneous notes.** Multiple dice hitting the
 *     floor in the same frame would spawn N short sources, none of them
 *     audibly distinct. We throttle to one clack per `MIN_GAP_MS`; rapid
 *     impacts collapse to a denser-sounding shake, which matches the
 *     visual.
 */

// Wood-hit throttle. Long enough to keep simultaneous floor impacts from
// stacking into a wall-of-clacks, short enough that a multi-die spill
// still reads as a busy shake.
const CLACK_MIN_GAP_MS = 35;
// Die-on-die has its own throttle (separate from the wood-hit one) so
// rolling dice can both knock the table AND click against each other in
// the same beat without one starving the other. The click is lighter and
// shorter, so a smaller minimum gap works.
const CLICK_MIN_GAP_MS = 20;
// The whoosh is the throw-air sound. One per throw is the only thing
// that makes sense — back-to-back rolls would overlap into a smear if
// we didn't space them out. Half a second is just past the perceptual
// "this was one sound" boundary.
const WHOOSH_MIN_GAP_MS = 500;
// Doubled from 0.4 — the first pass mixed under speech volume; users
// asked for it louder so it competes more with their tabletop ambience.
const MASTER_GAIN = 0.8;

class DiceAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = false;
  private lastClackAtMs = 0;
  private lastClickAtMs = 0;
  private lastWhooshAtMs = 0;

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
   * Wood hit — die hitting the tray floor or rail. Three components
   * (transient + woody body + sub-thump). `intensity` ∈ (0, 1] scales
   * volume and brightness. Throttled per CLACK_MIN_GAP_MS.
   */
  playClack(intensity = 1): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - this.lastClackAtMs < CLACK_MIN_GAP_MS) return;
    this.lastClackAtMs = nowMs;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const i = Math.min(1, Math.max(0.2, intensity));

    // --- Corner-strike transient: damped noise burst --------------------
    // Lowered from ~3 kHz to ~1.5 kHz and Q from 4-8 to 1.5-3 so the click
    // reads as a wood knock rather than a Lego stud snapping. Higher Q
    // makes the burst ring like a plastic resonance — exactly what we want
    // to avoid for tabletop dice.
    const noiseBuf = makeNoiseBuffer(ctx, 0.05);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + Math.random() * 700; // 1.2–1.9 kHz
    bp.Q.value = 1.5 + i * 1.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(i * 0.38, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    noiseSrc.connect(bp).connect(noiseGain).connect(this.masterGain);
    noiseSrc.start(t);
    noiseSrc.stop(t + 0.08);

    // --- Body thunk: mid-range woody resonance ---------------------------
    // Lifted the base from ~110 Hz to ~240 Hz (mid-wood range — closer to
    // a knock-on-table than a bass drum) and boosted gain so the body sits
    // forward in the mix instead of letting the transient dominate.
    const body = ctx.createOscillator();
    body.type = 'triangle'; // a few subtle harmonics → reads as wood, not pure tone
    const bodyFreq = 210 + Math.random() * 70; // 210–280 Hz
    body.frequency.setValueAtTime(bodyFreq, t);
    body.frequency.exponentialRampToValueAtTime(bodyFreq * 0.45, t + 0.06);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(i * 0.6, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

    body.connect(bodyGain).connect(this.masterGain);
    body.start(t);
    body.stop(t + 0.12);

    // --- Sub-thump: floor-impact felt-not-heard --------------------------
    // Only fires meaningfully on harder hits (gain scales with intensity²).
    // Adds physicality on speakers with bass response without muddying the
    // mix on phone speakers, which roll this band off anyway.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subFreq = 65 + Math.random() * 15;
    sub.frequency.setValueAtTime(subFreq, t);
    sub.frequency.exponentialRampToValueAtTime(subFreq * 0.7, t + 0.06);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(i * i * 0.45, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    sub.connect(subGain).connect(this.masterGain);
    sub.start(t);
    sub.stop(t + 0.09);
  }

  /**
   * Die-on-die contact — two resin/bone surfaces clicking together.
   * Deliberately quieter and shorter than playClack:
   *   - higher centre frequency (3–4.5 kHz noise + ~700 Hz pip) so it
   *     sits above the wood hits in the mix instead of competing with
   *     them on the same frequency band;
   *   - no sub-thump (these aren't floor impacts; they shouldn't move
   *     air);
   *   - master factor ~0.4× the clack so a busy roll has the wood hits
   *     as the dominant beat and the inter-die clicks as a subtler
   *     rattle underneath.
   * Has its own throttle so it can interleave with wood hits.
   */
  playClick(intensity = 1): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - this.lastClickAtMs < CLICK_MIN_GAP_MS) return;
    this.lastClickAtMs = nowMs;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const i = Math.min(1, Math.max(0.2, intensity));

    // High-mid transient — the surface-on-surface tick.
    const noiseBuf = makeNoiseBuffer(ctx, 0.035);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000 + Math.random() * 1500; // 3.0–4.5 kHz
    bp.Q.value = 2.5 + i * 1.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(i * 0.18, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

    noiseSrc.connect(bp).connect(noiseGain).connect(this.masterGain);
    noiseSrc.start(t);
    noiseSrc.stop(t + 0.05);

    // Brief mid-high pip — adds a hint of pitch to the noise burst so
    // each click sounds like a small object rather than a hiss.
    const pip = ctx.createOscillator();
    pip.type = 'sine';
    const pipFreq = 600 + Math.random() * 250; // 600–850 Hz
    pip.frequency.setValueAtTime(pipFreq, t);
    pip.frequency.exponentialRampToValueAtTime(pipFreq * 0.6, t + 0.03);

    const pipGain = ctx.createGain();
    pipGain.gain.setValueAtTime(i * 0.14, t);
    pipGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    pip.connect(pipGain).connect(this.masterGain);
    pip.start(t);
    pip.stop(t + 0.06);
  }

  /**
   * Throw whoosh — the airborne phase between the user pressing Roll and
   * the dice hitting the floor. A band-passed noise sweep from low-mid
   * (~350 Hz) up to mid (~1.1 kHz) reads as "air moving past the ear" and
   * sets up the impact sounds that follow without competing with them on
   * the same frequency band.
   *
   * `intensity` is meant to scale with quantity-of-dice (1 die → 0.4,
   * 6 dice → 1.0) so a fistful of D6s sounds like a fistful and a single
   * D20 sounds like a single die. Throttled separately so back-to-back
   * rolls don't smear into one whoosh.
   */
  playWhoosh(intensity = 1): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - this.lastWhooshAtMs < WHOOSH_MIN_GAP_MS) return;
    this.lastWhooshAtMs = nowMs;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const i = Math.min(1, Math.max(0.3, intensity));
    const duration = 0.4 + i * 0.15; // 400–550 ms covers the airborne phase

    // Flat white noise (no internal fade — the gain envelope shapes it).
    const buf = ctx.createBuffer(
      1,
      Math.max(1, Math.floor(ctx.sampleRate * duration)),
      ctx.sampleRate,
    );
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // Highpass first to lop off the sub-rumble noise contributes by
    // default — without this the whoosh muddies the mix with woofer
    // grunt on bigger speakers.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 200;

    // Band-pass sweep low→mid. The motion of the centre frequency is what
    // makes the brain hear "something rushed past me" instead of "noise".
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(1100, t + duration * 0.8);
    bp.Q.value = 0.7;

    const gain = ctx.createGain();
    // Gentle fade-in so the whoosh blooms rather than clicks on; longer
    // tail so it sits under the first dice impact instead of vanishing
    // before contact.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(i * 0.16, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(hp).connect(bp).connect(gain).connect(this.masterGain);
    src.start(t);
    src.stop(t + duration + 0.02);
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
