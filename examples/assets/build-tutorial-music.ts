// Offline asset builder: synthesizes the ~88s background bed for
// examples/openhypercore-tutorial.ts (pure additive synthesis — no sampled or
// copyrighted material). Same synth voice as build-music.ts "uplift", but with
// an arrangement arc: sparse intro → groove → full mix → lift → outro.
// Run:  node --experimental-strip-types examples/assets/build-tutorial-music.ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SR = 44100;
const DUR = 88;
const BPM = 100;

const N: Record<string, number> = {
  A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196,
  A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392
};
type Chord = { notes: number[]; bass: number };
const chords: Chord[] = [
  { notes: [N.A3!, N.C4!, N.E4!], bass: N.A2! },
  { notes: [N.F3!, N.A3!, N.C4!], bass: 87.31 },
  { notes: [N.C4!, N.E4!, N.G4!], bass: N.C3! },
  { notes: [N.G3!, N.B3!, N.D4!], bass: 98 }
];
const arpPat = [0, 1, 2, 1, 0, 2, 1, 2];

// Section envelope 0..1 for an element: list of [timeSec, gain] breakpoints.
function env(points: Array<[number, number]>, t: number): number {
  if (t <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i += 1) {
    const [t1, g1] = points[i]!;
    const [t0, g0] = points[i - 1]!;
    if (t <= t1) return g0 + (g1 - g0) * ((t - t0) / (t1 - t0));
  }
  return points[points.length - 1]![1];
}
// intro (title) → groove (concept/features) → full (editor) → lift (render) → outro
const kickEnv = (t: number) => env([[0, 0], [4.4, 0], [4.6, 0.85], [31, 0.85], [32, 1], [74, 1], [78, 0.5], [83, 0]], t);
const arpEnv2 = (t: number) => env([[0, 0.45], [4.6, 0.8], [32, 1], [76, 1], [86, 0.4]], t);
const brightEnv = (t: number) => env([[0, 0], [32, 0.12], [61, 0.35], [76, 0.2], [88, 0]], t);
const padEnv = (t: number) => env([[0, 0.9], [10, 1], [80, 1], [88, 0.8]], t);

const softclip = (x: number) => Math.tanh(x * 1.1);
const tone = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);

function synth(): Buffer {
  const beat = 60 / BPM, bar = beat * 4, eighth = beat / 2;
  let seed = 4211;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  const Nn = Math.floor(SR * DUR);
  const buf = Buffer.allocUnsafe(Nn * 4);
  for (let i = 0; i < Nn; i += 1) {
    const t = i / SR;
    const ch = chords[Math.floor(t / bar) % chords.length]!;
    const tBar = t % bar;

    let pad = 0;
    for (const f of ch.notes) pad += tone(f, t) + 0.5 * tone(f * 1.005, t);
    pad *= 0.05 * padEnv(t) * Math.min(1, tBar / 0.12) * Math.min(1, (bar - tBar) / 0.18);

    const arpIdx = Math.floor(t / eighth);
    const an = ch.notes[arpPat[arpIdx % arpPat.length]!]! * 2;
    const ap = t - arpIdx * eighth;
    const aEnv = Math.exp(-ap * 9) * (1 - Math.exp(-ap * 120));
    const arp = (Math.sin(2 * Math.PI * an * t) + 0.3 * Math.sin(2 * Math.PI * 2 * an * t) + brightEnv(t) * Math.sin(2 * Math.PI * 3 * an * t)) * 0.16 * arpEnv2(t) * aEnv;
    const arpPan = arpIdx % 2 === 0 ? 0.7 : 0.3;

    const bass = Math.sin(2 * Math.PI * ch.bass * t) * 0.22 * kickEnv(t) * Math.min(1, tBar / 0.02) * Math.exp(-tBar * 0.5);

    const kp = t % beat;
    const kick = (Math.exp(-kp * 16) * Math.sin(2 * Math.PI * 55 * kp) + Math.exp(-kp * 90) * Math.sin(2 * Math.PI * 150 * kp)) * 0.5 * kickEnv(t);

    const hp = (t + beat / 2) % beat;
    const hat = hp < 0.05 ? rnd() * Math.exp(-hp * 70) * 0.06 * kickEnv(t) : 0;

    const mono = pad + bass + kick;
    let g = 0.85;
    if (t < 0.6) g *= t / 0.6;
    if (t > DUR - 2.2) g *= Math.max(0, (DUR - t) / 2.2);
    const left = softclip((mono + arp * arpPan + hat) * g);
    const right = softclip((mono + arp * (1 - arpPan) + hat) * g);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left * 32767))), i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right * 32767))), i * 4 + 2);
  }
  return buf;
}

async function ffmpegPath(): Promise<string> {
  try {
    const mod = await import("@ffmpeg-installer/ffmpeg");
    const p = (mod.default as { path?: string } | undefined)?.path ?? (mod as { path?: string }).path;
    if (p) return p;
  } catch { /* fall through */ }
  return "ffmpeg";
}

async function main(): Promise<void> {
  const ff = await ffmpegPath();
  const out = resolve(here, "openhypercore-tutorial-bed-long.m4a");
  const pcm = synth();
  const enc = spawn(ff, ["-y", "-f", "s16le", "-ar", String(SR), "-ac", "2", "-i", "pipe:0", "-c:a", "aac", "-b:a", "160k", out], { stdio: ["pipe", "ignore", "inherit"] });
  if (!enc.stdin.write(pcm)) await once(enc.stdin, "drain");
  enc.stdin.end();
  const [code] = await once(enc, "close") as [number];
  if (code !== 0) throw new Error(`encode failed code ${code}`);
  process.stderr.write(`done → ${out}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
