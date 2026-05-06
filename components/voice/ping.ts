"use client";

/**
 * Play a short two-tone "ready to listen" chime via Web Audio. No external
 * asset needed; the function is fire-and-forget. Safe to call from a
 * non-user-gesture context after the operator has already interacted with
 * the page (which they have, since the voice widget required a click first).
 */
let cachedCtx: AudioContext | null = null;

export function playReadyPing(volume = 0.18): void {
  if (typeof window === "undefined") return;
  try {
    if (!cachedCtx) {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      cachedCtx = new Ctx();
    }
    if (cachedCtx.state === "suspended") {
      // Browsers suspend AudioContexts created without a gesture. Resume is
      // a noop on already-running contexts.
      void cachedCtx.resume();
    }
    const now = cachedCtx.currentTime;
    // Two soft tones: 880 → 1320 Hz over ~120ms total. Quick attack, gentle
    // release — feels like a friendly "ready" beep, not a notification.
    const tones: Array<{ freq: number; start: number; len: number }> = [
      { freq: 880, start: 0, len: 0.07 },
      { freq: 1320, start: 0.06, len: 0.09 },
    ];
    for (const t of tones) {
      const osc = cachedCtx.createOscillator();
      const gain = cachedCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0, now + t.start);
      gain.gain.linearRampToValueAtTime(volume, now + t.start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.len);
      osc.connect(gain).connect(cachedCtx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.len + 0.02);
    }
  } catch {
    // Audio playback isn't critical — silently ignore.
  }
}
