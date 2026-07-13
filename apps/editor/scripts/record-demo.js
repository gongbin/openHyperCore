// Records one continuous editor session (Chinese UI) with a visible fake
// cursor; logs chapter wall-clock offsets so the webm can be cut into clips.
const { chromium } = require("playwright");

const FOOTAGE = "/private/tmp/claude-501/-Users-gongbin-Documents-work-touchwaves-design-openHypreCore/b6fefd76-269d-4ac7-a77a-b7728ee58be4/scratchpad/rec/古城之旅-素材.mp4";

const CURSOR_JS = `
  (() => {
    const style = document.createElement("style");
    style.textContent = \`
      #pw-cursor { position: fixed; z-index: 999999; width: 20px; height: 20px;
        border-radius: 50%; background: rgba(255,255,255,0.35);
        border: 2px solid rgba(255,255,255,0.95);
        box-shadow: 0 1px 6px rgba(0,0,0,0.55); pointer-events: none;
        transform: translate(-50%,-50%); transition: width .12s, height .12s; left:-100px; top:-100px; }
      #pw-cursor.down { width: 14px; height: 14px; background: rgba(125,255,207,0.6); }
      .pw-ripple { position: fixed; z-index: 999998; width: 10px; height: 10px;
        border-radius: 50%; border: 2px solid rgba(125,255,207,0.9); pointer-events: none;
        transform: translate(-50%,-50%); animation: pwrip .5s ease-out forwards; }
      @keyframes pwrip { to { width: 46px; height: 46px; opacity: 0; } }\`;
    const attach = () => {
      document.head.appendChild(style);
      const c = document.createElement("div");
      c.id = "pw-cursor";
      document.body.appendChild(c);
      window.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      window.addEventListener("mousedown", (e) => {
        c.classList.add("down");
        const r = document.createElement("div");
        r.className = "pw-ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
        document.body.appendChild(r); setTimeout(() => r.remove(), 600);
      }, true);
      window.addEventListener("mouseup", () => c.classList.remove("down"), true);
    };
    if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);
  })();
`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-CN",
    recordVideo: { dir: "video", size: { width: 1600, height: 1000 } }
  });
  const p = await ctx.newPage();
  await p.addInitScript(CURSOR_JS);
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

  let cx = 800, cy = 500;
  const move = async (x, y, ms = 450) => {
    const steps = Math.max(8, Math.round(ms / 16));
    await p.mouse.move(x, y, { steps });
    cx = x; cy = y;
  };
  const moveToEl = async (locator, ms = 450, dx = 0, dy = 0) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error("no box for locator");
    await move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, ms);
    return box;
  };
  const click = async (locator, ms = 450) => {
    await moveToEl(locator, ms);
    await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up();
  };

  const t0 = Date.now();
  const mark = (name) => console.log(`MARK ${name} ${((Date.now() - t0) / 1000).toFixed(2)}`);

  await p.goto("http://localhost:5199/");
  await p.waitForTimeout(3800);

  // ---------------- Chapter A: Quick Start ----------------
  mark("A0");
  const tiles = p.locator(".qs-tile");
  await moveToEl(tiles.nth(2), 700); await p.waitForTimeout(450);
  await moveToEl(tiles.nth(4), 500); await p.waitForTimeout(450);
  await click(tiles.nth(1), 500);            // neon-trace-title
  await p.waitForTimeout(500);
  await click(p.locator(".qs-modal .btn-primary"), 500);
  await p.waitForTimeout(500);
  await click(p.locator("input.qs-title"), 400);
  await p.locator("input.qs-title").pressSequentially("古城之旅", { delay: 170 });
  await p.waitForTimeout(500);
  await click(p.locator(".qs-modal .btn-primary"), 450);
  await p.waitForTimeout(600);
  await moveToEl(p.locator(".qs-drop"), 500);
  await p.locator('.qs-modal input[type="file"]').setInputFiles(FOOTAGE);
  await p.waitForTimeout(2000);
  await click(p.locator(".qs-modal .btn-primary"), 550);
  await p.waitForTimeout(1800);
  // play the generated video
  await click(p.locator(".btn-play"), 600);
  await p.waitForTimeout(6800);
  await click(p.locator(".btn-play"), 300);
  await p.waitForTimeout(600);
  mark("A1");

  // ---------------- Chapter B: select + animate + edit ----------------
  mark("B0");
  // click the video on canvas to select it
  const cbox = await p.locator(".canvas-wrap canvas").boundingBox();
  await move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.5, 600);
  await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up();
  await p.waitForTimeout(900);
  // hover entrance-animation chips (hover = live preview), then apply 弹出
  const chip = (name) => p.locator("button", { hasText: name }).first();
  await moveToEl(chip("从左入"), 550); await p.waitForTimeout(1500);
  await moveToEl(chip("弹出"), 450); await p.waitForTimeout(1500);
  await click(chip("弹出"), 200);
  await p.waitForTimeout(900);
  // drag playhead back and replay the new entrance
  const ph = p.locator(".playhead-cap");
  if (await ph.count()) {
    const pb = await ph.boundingBox();
    if (pb) {
      await move(pb.x + pb.width / 2, pb.y + pb.height / 2, 500);
      await p.mouse.down();
      await move(pb.x - (pb.x - 140) * 0.55, pb.y + pb.height / 2, 700); // scrub left
      await p.mouse.up();
    }
  }
  await p.waitForTimeout(500);
  await click(p.locator(".btn-play"), 400);
  await p.waitForTimeout(3200);
  await click(p.locator(".btn-play"), 300);
  await p.waitForTimeout(400);
  // nudge the layer on canvas (direct manipulation)
  await move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.45, 500);
  await p.mouse.down();
  await move(cbox.x + cbox.width * 0.56, cbox.y + cbox.height * 0.38, 600);
  await move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.45, 600);
  await p.mouse.up();
  await p.waitForTimeout(800);
  mark("B1");

  // ---------------- Chapter C: plugin gallery ----------------
  mark("C0");
  await click(p.locator(".nav-pill", { hasText: "插件库" }), 600);
  await p.waitForTimeout(1600);
  const cards = p.locator(".pg-card, [class*=card]");
  const cardByText = (txt) => p.locator("button, div", { hasText: txt }).filter({ has: p.locator("canvas, video, img") }).first();
  // hover/click a few cards — right panel live-previews each
  const tryCard = async (txt, dwell) => {
    const el = p.getByText(txt, { exact: true }).first();
    if (await el.count()) { await click(el, 550); await p.waitForTimeout(dwell); }
  };
  await tryCard("Hyperspace Warp", 2000);
  await tryCard("Kinetic Bars", 1800);
  await p.mouse.wheel(0, 420);
  await p.waitForTimeout(700);
  await tryCard("Particle Assemble", 2000);
  await p.waitForTimeout(300);
  mark("C1");

  // ---------------- Chapter D: render MP4 via service ----------------
  mark("D0");
  await click(p.locator(".nav-pill", { hasText: "编辑器" }), 500);
  await p.waitForTimeout(600);
  await click(p.locator("header .btn-primary", { hasText: "渲染 MP4" }), 600);
  await p.waitForTimeout(1200);
  const dl = p.waitForEvent("download", { timeout: 90000 }).catch(() => null);
  await click(p.locator(".modal .btn-primary", { hasText: "渲染" }), 550);
  // wait for completion text
  await p.locator(".modal", { hasText: "完成" }).waitFor({ timeout: 90000 }).catch(() => console.log("render wait timeout"));
  await dl;
  await p.waitForTimeout(2500);
  mark("D1");

  await ctx.close(); // flushes video
  const path = await p.video().path();
  console.log("VIDEO", path);
  await b.close();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });

// ---------------------------------------------------------------------------
// 用法（重录 examples/assets/editor-*.mp4 素材时）：
//   1. cd apps/editor && pnpm dev --port 5199 --strictPort
//   2. 仓库根: OPENHYPERCORE_RENDERER=native pnpm cli serve --port 8787
//   3. 任一带 playwright 的目录: node apps/editor/scripts/record-demo.js
//      （需 npm i playwright && npx playwright install chromium；
//        FOOTAGE 常量指向一段本地视频素材）
//   4. 按 stdout 的 MARK A0/A1/B0... 时间戳用 ffmpeg 切成
//      editor-quickstart / editor-animate / editor-plugins / editor-render 四段。
// ---------------------------------------------------------------------------
