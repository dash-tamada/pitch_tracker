/**
 * The "camera monitor" look: a random set of camera settings and a take number, made once per login and kept for
 * the length of the tab session so the slate, the announcement and the dashboard overlay all agree. Purely
 * cosmetic — nothing here is used for anything but display. Storage can be blocked, so every access is guarded.
 */
export interface Take {
  take: string;        // "042"
  scene: number;
  fps: string; shutter: string; iris: string; ei: string; nd: string; wb: string; cc: string; side: string;
  fcl: string; bat: string; cam: string; clip: string; media: string; roll: string; tilt: string;
  startSeconds: number; // where the timecode starts, in seconds from midnight
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const int = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo + 1));
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const signed = (n: number, d = 1) => `${n < 0 ? "-" : "+"}${Math.abs(n).toFixed(d)}`;

export function newTake(): Take {
  const take = int(1, 999);
  return {
    take: pad(take, 3), scene: int(1, 120),
    fps: pick(["23.976", "24.000", "25.000", "29.970", "30.000", "50.000", "59.940"]),
    shutter: pick(["172.8", "180.0", "144.0", "90.0", "45.0", "360.0"]),
    iris: `T ${pick(["1.4", "2.0", "2.8", "4.0", "5.6", "8.0"])}`,
    ei: pick(["200", "400", "800", "1600", "3200"]),
    nd: pick(["-", "0.3", "0.6", "0.9", "1.2", "1.8"]),
    wb: `${pick([3200, 3600, 4300, 4600, 5200, 5600, 6500])} K`,
    cc: `${signed((int(-10, 10)) / 2)} CC`,
    side: pick(["A", "B", "C", "D"]),
    fcl: `${pick([18, 24, 28, 35, 50, 65, 85, 100])}.0mm`,
    bat: `${(12 + Math.random() * 4.4).toFixed(1)}V`,
    cam: `${pick(["A", "B", "C"])}${pad(int(1, 999), 3)}`, clip: `C${pad(take, 3)}`,
    media: `${int(0, 3)}:${pad(int(0, 59), 2)} h`,
    roll: `${signed(Math.random() * 14 - 7, 1)}°`, tilt: `${signed(Math.random() * 20 - 10, 1)}°`,
    startSeconds: int(6, 22) * 3600 + int(0, 59) * 60 + int(0, 59),
  };
}

/** Says a line through the browser's speech engine, when there is one and sound is on. */
export function speak(text: string, soundOn: boolean): void {
  try {
    if (!soundOn || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95; u.pitch = 0.8; u.volume = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* no speech: the visuals are enough */ }
}

/** "Take 42". */
export const announceTake = (take: string, soundOn: boolean) => speak(`Take ${Number(take)}`, soundOn);


