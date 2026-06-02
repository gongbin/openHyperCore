// Offline asset builder: warps a public-domain equirectangular Earth texture
// (NASA Blue Marble / Visible Earth — public domain) into a rotating + zooming
// orthographic globe clip with simple lighting, a limb-darkened terminator, an
// atmosphere rim and a starry purple background. Output is examples/assets/
// globe.mp4, which the globe-texture.ts composition then uses as a VideoLayer.
//
// Pure CPU: only FFmpeg is used (to decode the JPEG and to encode the clip).
// Run:  node --experimental-strip-types examples/assets/build-globe.ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const TEXTURE = resolve(here, "earth-hi.jpg");
const OUT = resolve(here, "globe.mp4");

const W = 1280, H = 720, FPS = 25;
const FRAMES = 102;            // ~4.08s
const cx = W / 2, cy = H / 2;
const TW = 5400, TH = 2700;    // texture size (forced on decode)

// Target city to home in on (Chongqing 重庆 ≈ 29.56°N, 106.55°E).
const cityLat = (29.563 * Math.PI) / 180;
const cityLon = (106.551 * Math.PI) / 180;

// Orientation: yaw (about Y) brings the city longitude to front, pitch (about X)
// lifts its latitude to centre. Both settle by ~70% of the clip, so the globe
// slowly rotates the city into the middle, then the zoom drives in on it.
const R0 = 214;
const extraTurns = 0.55;       // how far it rotates before settling on the city
const Zextra = 1.9;            // zoom-in amount
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const orientEase = (p: number) => easeInOutCubic(clamp01(p / 0.72));
const spinAt = (p: number) => cityLon - (1 - orientEase(p)) * extraTurns * 2 * Math.PI;
const tiltAt = (p: number) => -cityLat * orientEase(p);
const zoomAt = (p: number) => 1 + Zextra * Math.pow(p, 1.6);

// Light direction (unit-ish), upper-left, towards viewer (screen y is down).
const Lx = -0.42, Ly = 0.55, Lz = 0.72;

async function ffmpegPath(): Promise<string> {
  try {
    const mod = await import("@ffmpeg-installer/ffmpeg");
    const p = (mod.default as { path?: string } | undefined)?.path ?? (mod as { path?: string }).path;
    if (p) return p;
  } catch { /* fall through */ }
  return "ffmpeg";
}

async function decodeTexture(ff: string): Promise<Buffer> {
  const child = spawn(ff, [
    "-hide_banner", "-loglevel", "error",
    "-i", TEXTURE,
    "-vf", `scale=${TW}:${TH}`,
    "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => chunks.push(c));
  const errs: Buffer[] = [];
  child.stderr.on("data", (c: Buffer) => errs.push(c));
  const [code] = await once(child, "close") as [number];
  if (code !== 0) throw new Error("texture decode failed: " + Buffer.concat(errs).toString());
  const buf = Buffer.concat(chunks);
  if (buf.length !== TW * TH * 4) throw new Error(`unexpected texture size ${buf.length}`);
  return buf;
}

// Bilinear sample of the equirectangular texture from lon/lat (radians).
function sample(tex: Buffer, lon: number, lat: number, out: { r: number; g: number; b: number }): void {
  let u = 0.5 + lon / (2 * Math.PI);
  let v = 0.5 - lat / Math.PI;
  u -= Math.floor(u);
  if (v < 0) v = 0; else if (v > 0.99999) v = 0.99999;
  const fx = u * TW - 0.5, fy = v * TH - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const x1 = (x0 + 1) % TW, y1 = Math.min(TH - 1, y0 + 1);
  const xa = ((x0 % TW) + TW) % TW;
  const i00 = (y0 * TW + xa) * 4, i10 = (y0 * TW + x1) * 4, i01 = (y1 * TW + xa) * 4, i11 = (y1 * TW + x1) * 4;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  out.r = tex[i00]! * w00 + tex[i10]! * w10 + tex[i01]! * w01 + tex[i11]! * w11;
  out.g = tex[i00 + 1]! * w00 + tex[i10 + 1]! * w10 + tex[i01 + 1]! * w01 + tex[i11 + 1]! * w11;
  out.b = tex[i00 + 2]! * w00 + tex[i10 + 2]! * w10 + tex[i01 + 2]! * w01 + tex[i11 + 2]! * w11;
}

// Static starry purple background (computed once, reused each frame).
function buildBackground(): Uint8Array {
  const bg = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / 720;
      const k = Math.min(1, d);
      const r = Math.round(46 * (1 - k) + 14 * k);
      const g = Math.round(38 * (1 - k) + 12 * k);
      const b = Math.round(108 * (1 - k) + 40 * k);
      const i = (y * W + x) * 4;
      bg[i] = r; bg[i + 1] = g; bg[i + 2] = b; bg[i + 3] = 255;
    }
  }
  // deterministic stars
  for (let s = 0; s < 200; s += 1) {
    const x = (s * 89 + 37) % W;
    const y = (s * 47 + 19) % H;
    const bright = 150 + ((s * 31) % 105);
    const cyanish = s % 11 === 0;
    const put = (px: number, py: number, a: number) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = (py * W + px) * 4;
      bg[i] = Math.min(255, bg[i]! + (cyanish ? a * 0.5 : a));
      bg[i + 1] = Math.min(255, bg[i + 1]! + a);
      bg[i + 2] = Math.min(255, bg[i + 2]! + a);
    };
    put(x, y, bright);
    if (s % 6 === 0) { put(x + 1, y, bright * 0.4); put(x - 1, y, bright * 0.4); put(x, y + 1, bright * 0.4); put(x, y - 1, bright * 0.4); }
  }
  return bg;
}

async function main(): Promise<void> {
  const ff = await ffmpegPath();
  const tex = await decodeTexture(ff);
  const bg = buildBackground();

  const enc = spawn(ff, [
    "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-framerate", String(FPS),
    "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-crf", "18",
    "-movflags", "+faststart", OUT
  ], { stdio: ["pipe", "ignore", "inherit"] });

  const frame = Buffer.allocUnsafe(W * H * 4);
  const texel = { r: 0, g: 0, b: 0 };
  const Llen = Math.hypot(Lx, Ly, Lz);
  const lx = Lx / Llen, ly = Ly / Llen, lz = Lz / Llen;

  for (let f = 0; f < FRAMES; f += 1) {
    const p = f / (FRAMES - 1);
    const R = R0 * zoomAt(p);
    const spin = spinAt(p), tilt = tiltAt(p);
    const cosS = Math.cos(spin), sinS = Math.sin(spin), cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    frame.set(bg);

    const x0 = Math.max(0, Math.floor(cx - R - 36)), x1 = Math.min(W, Math.ceil(cx + R + 36));
    const y0 = Math.max(0, Math.floor(cy - R - 36)), y1 = Math.min(H, Math.ceil(cy + R + 36));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = x - cx, dy = y - cy;
        const rr = Math.sqrt(dx * dx + dy * dy);
        const i = (y * W + x) * 4;
        if (rr <= R) {
          // screen normal
          const nx = dx / R, ny = -dy / R;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          // inverse-rotate about vertical axis → model coords
          const az = ny * sinT + nz * cosT;
          const mx = nx * cosS + az * sinS;
          const my = ny * cosT - nz * sinT;
          const mz = -nx * sinS + az * cosS;
          const lon = Math.atan2(mx, mz);
          const lat = Math.asin(Math.max(-1, Math.min(1, my)));
          sample(tex, lon, lat, texel);
          // lighting + limb darkening
          const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
          const limb = Math.min(1, nz * 4.5);
          const shade = (0.32 + 0.78 * lambert) * (0.45 + 0.55 * limb);
          frame[i] = Math.min(255, texel.r * shade);
          frame[i + 1] = Math.min(255, texel.g * shade);
          frame[i + 2] = Math.min(255, texel.b * shade);
          frame[i + 3] = 255;
        } else if (rr <= R + 34) {
          // atmosphere rim glow blended over background
          const t = 1 - (rr - R) / 34;
          const g = t * t * 150;
          frame[i] = Math.min(255, frame[i]! + g * 0.35);
          frame[i + 1] = Math.min(255, frame[i + 1]! + g * 0.85);
          frame[i + 2] = Math.min(255, frame[i + 2]! + g);
        }
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
