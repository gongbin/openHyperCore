// Offline asset builder: synthesizes several original, royalty-free background
// music beds (pure additive synthesis — no sampled/copyrighted material) and
// encodes each to examples/assets/bgm-<preset>.m4a. Different reels point at
// different tracks, so nothing is hardcoded to one tune.
// Run:  node --experimental-strip-types examples/assets/build-music.ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SR = 44100;
const DUR = 18;

// note frequencies
const N: Record<string, number> = {
  A2: 110, B2: 123.47, C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, G3: 196,
  Ab3: 207.65, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440
};
type Chord = { notes: number[]; bass: number };
type Preset = {
  name: string; bpm: number; chords: Chord[];
  padGain: number; arpGain: number; kickGain: number; hatGain: number; bassGain: number;
  arpOct: number; saw: number; bright: number; arpPat: number[];
};

const presets: Preset[] = [
  { name: "uplift", bpm: 100, arpOct: 2, saw: 0, bright: 0, padGain: 0.05, arpGain: 0.16, kickGain: 0.5, hatGain: 0.06, bassGain: 0.22, arpPat: [0, 1, 2, 1, 0, 2, 1, 2],
    chords: [{ notes: [N.A3!, N.C4!, N.E4!], bass: N.A2! }, { notes: [N.F3!, N.A3!, N.C4!], bass: 87.31 }, { notes: [N.C4!, N.E4!, N.G4!], bass: N.C3! }, { notes: [N.G3!, N.B3!, N.D4!], bass: 98 }] },
  { name: "pop", bpm: 124, arpOct: 2, saw: 0.12, bright: 0.4, padGain: 0.045, arpGain: 0.18, kickGain: 0.62, hatGain: 0.09, bassGain: 0.24, arpPat: [0, 2, 1, 2, 0, 1, 2, 1],
    chords: [{ notes: [N.C4!, N.E4!, N.G4!], bass: N.C3! }, { notes: [N.G3!, N.B3!, N.D4!], bass: 98 }, { notes: [N.A3!, N.C4!, N.E4!], bass: N.A2! }, { notes: [N.F3!, N.A3!, N.C4!], bass: 87.31 }] },
  { name: "cyber", bpm: 92, arpOct: 1, saw: 0.55, bright: 0, padGain: 0.07, arpGain: 0.12, kickGain: 0.42, hatGain: 0.05, bassGain: 0.3, arpPat: [0, 1, 2, 2, 1, 0, 1, 2],
    chords: [{ notes: [N.A3!, N.C4!, N.E4!], bass: N.A2! }, { notes: [N.F3!, N.A3!, N.C4!], bass: 87.31 }, { notes: [N.D4!, N.F3!, N.A3!], bass: N.D3! }, { notes: [N.E3!, N.Ab3!, N.B3!], bass: 82.41 }] },
  { name: "epic", bpm: 108, arpOct: 2, saw: 0.25, bright: 0.2, padGain: 0.062, arpGain: 0.15, kickGain: 0.56, hatGain: 0.05, bassGain: 0.28, arpPat: [0, 1, 2, 1, 2, 1, 0, 1],
    chords: [{ notes: [N.A3!, N.C4!, N.E4!], bass: N.A2! }, { notes: [N.F3!, N.A3!, N.C4!], bass: 87.31 }, { notes: [N.C4!, N.E4!, N.G4!], bass: N.C3! }, { notes: [N.G3!, N.B3!, N.D4!], bass: 98 }] }
];

const softclip = (x: number) => Math.tanh(x * 1.1);
// a saw-ish tone (sine + odd partials) for synthwave pads
const tone = (f: number, t: number, saw: number) => Math.sin(2 * Math.PI * f * t) + saw * (0.5 * Math.sin(2 * Math.PI * 2 * f * t) + 0.33 * Math.sin(2 * Math.PI * 3 * f * t));

function synth(p: Preset): Buffer {
  const beat = 60 / p.bpm, bar = beat * 4, eighth = beat / 2;
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  const Nn = Math.floor(SR * DUR);
  const buf = Buffer.allocUnsafe(Nn * 4);
  for (let i = 0; i < Nn; i += 1) {
    const t = i / SR;
    const ch = p.chords[Math.floor(t / bar) % p.chords.length]!;
    const tBar = t % bar;

    let pad = 0;
    for (const f of ch.notes) pad += tone(f, t, p.saw) + 0.5 * tone(f * 1.005, t, p.saw);
    pad *= p.padGain * Math.min(1, tBar / 0.12) * Math.min(1, (bar - tBar) / 0.18);

    const arpIdx = Math.floor(t / eighth);
    const an = ch.notes[p.arpPat[arpIdx % p.arpPat.length]!]! * p.arpOct;
    const ap = t - arpIdx * eighth;
    const arpEnv = Math.exp(-ap * 9) * (1 - Math.exp(-ap * 120));
    const arp = (Math.sin(2 * Math.PI * an * t) + 0.3 * Math.sin(2 * Math.PI * 2 * an * t) + p.bright * Math.sin(2 * Math.PI * 3 * an * t)) * p.arpGain * arpEnv;
    const arpPan = arpIdx % 2 === 0 ? 0.7 : 0.3;

    const bass = Math.sin(2 * Math.PI * ch.bass * t) * p.bassGain * Math.min(1, tBar / 0.02) * Math.exp(-tBar * 0.5);

    const kp = t % beat;
    const kick = (Math.exp(-kp * 16) * Math.sin(2 * Math.PI * 55 * kp) + Math.exp(-kp * 90) * Math.sin(2 * Math.PI * 150 * kp)) * p.kickGain;

    const hp = (t + beat / 2) % beat;
    const hat = hp < 0.05 ? rnd() * Math.exp(-hp * 70) * p.hatGain : 0;

    const mono = pad + bass + kick;
    let g = 0.85;
    if (t < 0.6) g *= t / 0.6;
    if (t > DUR - 1.6) g *= Math.max(0, (DUR - t) / 1.6);
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

async function encode(ff: string, pcm: Buffer, out: string): Promise<void> {
  const enc = spawn(ff, ["-y", "-f", "s16le", "-ar", String(SR), "-ac", "2", "-i", "pipe:0", "-c:a", "aac", "-b:a", "160k", out], { stdio: ["pipe", "ignore", "inherit"] });
  if (!enc.stdin.write(pcm)) await once(enc.stdin, "drain");
  enc.stdin.end();
  const [code] = await once(enc, "close") as [number];
  if (code !== 0) throw new Error(`encode failed (${out}) code ${code}`);
}

async function main(): Promise<void> {
  const ff = await ffmpegPath();
  for (const p of presets) {
    const out = resolve(here, `bgm-${p.name}.m4a`);
    await encode(ff, synth(p), out);
    process.stderr.write(`done → ${out}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
