/** A gentle end-of-session chime (Web Audio, no files) and a soft vibration. */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/**
 * Browsers only allow sound after a user gesture, so call this from the
 * Start / Resume / +5 taps; the chime can then play when the timer ends.
 */
export function primeAudio(): void {
  try {
    void audioContext()?.resume();
  } catch {
    // Sound is a nicety; ignore failures.
  }
}

/** Three soft, rising sine notes that fade out over about two seconds. */
export function playChime(): void {
  try {
    const ac = audioContext();
    if (!ac) return;
    void ac.resume();
    const start = ac.currentTime + 0.05;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const t = start + i * 0.35;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 1.9);
    });
  } catch {
    // Ignore: no audio output available.
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([160, 120, 160]);
  } catch {
    // Not supported (e.g. iOS, desktop).
  }
}
