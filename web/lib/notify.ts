// Client-only notification helpers: sound (WebAudio synthesized chime) + vibration.
// Browsers require a user gesture before audio plays — call `primeNotify()`
// on any user click to unlock the AudioContext.

const STORAGE_KEY = "pa_notify_enabled";

let ctx: AudioContext | null = null;
let primed = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  return ctx;
}

export function isNotifyEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v == null ? true : v === "1";
}

export function setNotifyEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

// Resume the AudioContext after a user gesture. Safe to call repeatedly.
export function primeNotify(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  primed = true;
}

function chime(): void {
  const c = getCtx();
  if (!c) return;
  // C5 → E5 → G5 ascending major triad
  const notes = [523.25, 659.25, 783.99];
  const now = c.currentTime;
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.12;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

export function notifyTableFound(): void {
  if (!isNotifyEnabled()) return;
  chime();
  vibrate([120, 60, 120, 60, 220]);
}

// True once the user has interacted enough for audio to be allowed.
export function isPrimed(): boolean {
  return primed;
}
