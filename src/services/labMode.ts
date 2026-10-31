// Lab Mode support — spec §4.13/§5.5 (AC-LAB-5). Wake Lock where
// supported, silent fallback where not; beeps generated with the Web Audio
// API (no audio files), gated by the caller's audio-cues setting.
type WakeLockSentinelLike = { release: () => Promise<void> };

let wakeLock: WakeLockSentinelLike | null = null;
let audioContext: AudioContext | null = null;

export async function requestWakeLock(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: string) => Promise<WakeLockSentinelLike> } };
    if (typeof nav.wakeLock?.request !== 'function') return false;
    wakeLock = await nav.wakeLock.request('screen');
    return true;
  } catch {
    // Silent fallback (§5.5 AC-LAB-5): Lab Mode works without the lock.
    wakeLock = null;
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    // Already released; nothing to do.
  }
  wakeLock = null;
}

export function playBeep(frequency = 880, durationMs = 120): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + durationMs / 1000);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + durationMs / 1000);
  } catch {
    // Audio unavailable: Lab Mode works silently.
  }
}
