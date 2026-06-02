// Offline asset builder: a synthwave/cyber background — animated neon
// perspective grid floor + magenta glow + scanlines — encoded to
// examples/assets/cyber-bg.mp4 (720×1280) for the cyber-glitch opener.
// Pure CPU pixel synthesis; only FFmpeg is used (to encode).
// Run:  node --experimental-strip-types examples/assets/build-cyber-bg.ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "cyber-bg.mp4");

const W = 720, H = 1280, FPS = 30, FRAMES = 290; // ~9.67s (covers opener + body)
const cx = W / 2;
const hy = 560;            // horizon (grid is below)
const cellW = 92;          // vertical line spacing (world units at the foreground)

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
  const enc = spawn(ff, [
    "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-framerate", String(FPS),
    "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-crf", "20",
    "-movflags", "+faststart", OUT
  ], { stdio: ["pipe", "ignore", "inherit"] });

  const frame = Buffer.allocUnsafe(W * H * 4);
  for (let f = 0; f < FRAMES; f += 1) {
    const scroll = (f / FRAMES) * 2; // lines flow toward the viewer (loops every 2)
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        // base near-black with a faint magenta lift near the horizon
        let r = 6, g = 7, b = 13;

        // magenta radial glow centred up top
        const gdx = x - cx, gdy = y - 380;
        const gd2 = gdx * gdx + gdy * gdy;
        const glow = Math.exp(-gd2 / (2 * 210 * 210));
        r += glow * 120; g += glow * 18; b += glow * 95;

        // neon perspective grid below the horizon
        if (y > hy) {
          const dd = (y - hy) / (H - hy);           // 0 at horizon → 1 at bottom
          const depth = Math.pow(dd, 0.9);          // brightness toward the viewer
          // vertical lines converge to the vanishing point
          const worldX = (x - cx) / Math.max(dd, 0.001);
          const m = worldX / cellW;
          const vfrac = Math.abs(m - Math.round(m)) * cellW * dd; // screen-space distance to line
          const vline = Math.max(0, 1 - vfrac / 1.6);
          // horizontal lines stream toward the viewer
          const worldZ = 1 / Math.max(dd, 0.012);
          const n = worldZ * 0.55 + scroll;
          const hfrac = Math.abs(n - Math.round(n));
          const hline = Math.max(0, 1 - hfrac / (0.02 + 0.05 * dd));
          const line = Math.max(vline, hline) * (0.25 + 0.75 * depth);
          r += line * 31; g += line * 240; b += line * 255;
        }

        // scanlines + a faint vignette
        if (y % 3 === 0) { r *= 0.62; g *= 0.62; b *= 0.62; }

        const i = (y * W + x) * 4;
        frame[i] = Math.min(255, r); frame[i + 1] = Math.min(255, g); frame[i + 2] = Math.min(255, b); frame[i + 3] = 255;
      }
    }
    if (!enc.stdin.write(Buffer.from(frame))) await once(enc.stdin, "drain");
    if (f % 20 === 0) process.stderr.write(`frame ${f}/${FRAMES}\n`);
  }
  enc.stdin.end();
  const [code] = await once(enc, "close") as [number];
  if (code !== 0) throw new Error("encode failed code " + code);
  process.stderr.write(`done → ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
