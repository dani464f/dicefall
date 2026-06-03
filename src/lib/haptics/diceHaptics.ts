/**
 * Procedural dice haptics — wraps `navigator.vibrate()` with the same
 * gate / throttle pattern the audio engine uses, so each impact in
 * DiceScene fires one short pulse paired to the audio.
 *
 * Support matrix:
 *   - Android Chrome/Firefox: real haptic motor → vibration is felt
 *   - Desktop Chrome/Firefox: API exists, no motor → silent no-op
 *   - iOS Safari: API not exposed (Apple deliberate) → falls through here
 *
 * We don't try to detect "is there a real motor" — the calls are cheap,
 * and the user controls the toggle in Settings. If a device claims
 * support but has no motor (most laptops), nothing user-visible happens
 * either way.
 *
 * Why not the throw/whoosh moment too?
 *   The throw is initiated by the user pressing the Roll button —
 *   their thumb is already moving. A separate vibration there reads as
 *   a click confirmation, not as the dice. Tying haptics to the *visual
 *   landing* of the dice is what makes the throw feel grounded.
 */

const MIN_GAP_MS = 50;
const MIN_PULSE_MS = 6;
const MAX_PULSE_MS = 28;

class DiceHaptics {
  private enabled = false;
  private lastPulseAtMs = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Trigger a brief vibration scaled by `intensity` ∈ (0, 1]. No-op when
   * disabled, when the API is unavailable, or when called inside the
   * throttle window of the previous pulse.
   */
  pulse(intensity = 1): void {
    if (!this.enabled) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }
    const nowMs = performance.now();
    if (nowMs - this.lastPulseAtMs < MIN_GAP_MS) return;
    this.lastPulseAtMs = nowMs;

    const i = Math.min(1, Math.max(0.2, intensity));
    const duration = Math.round(MIN_PULSE_MS + (MAX_PULSE_MS - MIN_PULSE_MS) * i);
    try {
      navigator.vibrate(duration);
    } catch {
      // Some embedded WebViews throw if the page is hidden; ignore.
    }
  }

  /**
   * One slightly longer pulse on the final settle so the result-reveal
   * has a tactile beat under it. Intentionally a single fixed-length
   * pulse rather than a pattern — patterns ([on, off, on]) feel like
   * notifications, not impacts.
   */
  settlePulse(): void {
    if (!this.enabled) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }
    try {
      navigator.vibrate(35);
    } catch {
      // ignore
    }
  }
}

export const diceHaptics = new DiceHaptics();
