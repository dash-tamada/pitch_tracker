"use client";

/**
 * Film-set sound effects for the sign-in sequence, synthesised with the Web Audio API.
 *
 * Nothing is downloaded: the camera whir, sprocket clatter, "speed" beep and the clap are all generated
 * from oscillators and shaped noise, so there are no audio files to host and nothing for the CSP to allow.
 *
 * Browsers only let a page start audio from a user gesture, so the context is created (or resumed) by
 * `primeAudio()` inside a click/submit handler. Sounds scheduled later — the clap lands after the sign-in
 * request comes back — then play on that already-running context.
 *
 * The on/off choice is a per-viewer convenience kept in localStorage; every access is guarded because
 * storage can be blocked (private windows, strict settings), in which case sound simply stays on.
 */

const KEY = "pt_sound";
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try { return window.localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage blocked: preference lasts this page only */ }
  if (!on && ctx) void ctx.suspend();
  if (on && ctx) void ctx.resume();
}

/** Call from inside a user gesture. Returns null when sound is off or unsupported. */
export function primeAudio(): AudioContext | null {
  if (!soundEnabled()) return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function live(): AudioContext | null {
  return ctx && soundEnabled() ? ctx : null;
}

/** A burst of white noise of the given length, for clicks and the clap. */
function noise(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * The camera rolling: a motor that spins up to speed, plus the clatter of film running through the gate
 * at 24 frames a second. Fades in and out on its own.
 */
export function playRoll(seconds = 2.5): void {
  const c = live(); if (!c) return;
  const t = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.5, t + 0.3);
  out.gain.setValueAtTime(0.5, t + seconds - 0.45);
  out.gain.linearRampToValueAtTime(0, t + seconds);
  out.connect(c.destination);

  // motor: a low sawtooth that winds up from a growl to running speed
  const motor = c.createOscillator();
  motor.type = "sawtooth";
  motor.frequency.setValueAtTime(28, t);
  motor.frequency.exponentialRampToValueAtTime(62, t + 0.7);
  const motorTone = c.createBiquadFilter();
  motorTone.type = "lowpass"; motorTone.frequency.value = 380;
  const motorGain = c.createGain(); motorGain.gain.value = 0.22;
  motor.connect(motorTone).connect(motorGain).connect(out);
  motor.start(t); motor.stop(t + seconds);

  // gate clatter: a 24Hz train of short noise ticks, built straight into one buffer
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const s = i / c.sampleRate;
    const rate = 12 + 12 * Math.min(1, s / 0.7);          // ticks speed up with the motor
    const phase = (s * rate) % 1;
    d[i] = (Math.random() * 2 - 1) * Math.exp(-phase * 55) * 0.9;
  }
  const clatter = c.createBufferSource(); clatter.buffer = buf;
  const gate = c.createBiquadFilter(); gate.type = "bandpass"; gate.frequency.value = 2200; gate.Q.value = 0.9;
  const clatterGain = c.createGain(); clatterGain.gain.value = 0.32;
  clatter.connect(gate).connect(clatterGain).connect(out);
  clatter.start(t);
}

/** The sound recordist's "speed" beep. */
export function playBeep(delaySeconds = 0): void {
  const c = live(); if (!c) return;
  const t = c.currentTime + delaySeconds;
  const osc = c.createOscillator(); osc.type = "sine"; osc.frequency.value = 1000;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.01);
  g.gain.setValueAtTime(0.12, t + 0.16);
  g.gain.linearRampToValueAtTime(0, t + 0.19);
  osc.connect(g).connect(c.destination);
  osc.start(t); osc.stop(t + 0.2);
}

/** The clapper sticks meeting: a hard crack of noise over a short wooden knock. */
export function playClap(delaySeconds = 0): void {
  const c = live(); if (!c) return;
  const t = c.currentTime + delaySeconds;

  const crack = c.createBufferSource(); crack.buffer = noise(c, 0.18);
  const crackTone = c.createBiquadFilter(); crackTone.type = "highpass"; crackTone.frequency.value = 900;
  const crackGain = c.createGain();
  crackGain.gain.setValueAtTime(0.9, t);
  crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  crack.connect(crackTone).connect(crackGain).connect(c.destination);
  crack.start(t);

  const knock = c.createOscillator(); knock.type = "sine";
  knock.frequency.setValueAtTime(240, t);
  knock.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  const knockGain = c.createGain();
  knockGain.gain.setValueAtTime(0.55, t);
  knockGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  knock.connect(knockGain).connect(c.destination);
  knock.start(t); knock.stop(t + 0.13);
}
