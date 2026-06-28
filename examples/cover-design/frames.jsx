/* frames.jsx — six short-video intro (片头) style frames, 9:16
   Each export is a self-contained "hero moment" keyframe + spec band.
   Exposed on window for index.html to mount inside the design canvas. */

const FW = 405, FH = 720;

/* ── shared bits ───────────────────────────────────────── */

// striped image placeholder with a mono caption
function Photo({ label, style, dark }) {
  const base = dark ? '#1a1c22' : '#cdbfa6';
  const line = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `repeating-linear-gradient(45deg, ${base} 0 10px, ${line} 10px 20px)`,
      color: dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.4)',
      fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.05em',
      ...style,
    }}>{label}</div>
  );
}

// fine-grain film noise as an inline SVG data-uri
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function Frame({ children, bg }) {
  return (
    <div style={{ position: 'relative', width: FW, height: FH, overflow: 'hidden', background: bg, color: '#fff' }}>
      {children}
      {/* duration hint */}
    </div>
  );
}

function Spec({ idx, name, en, fonts, motion, swatches }) {
  return (
    <div style={{
      width: FW, boxSizing: 'border-box', padding: '18px 20px 20px',
      background: '#fff', borderTop: '1px solid #eee',
      fontFamily: "'Noto Sans SC', sans-serif",
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: '#bbb' }}>{idx}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: '#bbb', marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: '.08em' }}>{en}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
        <SpecRow k="字体" v={fonts} />
        <div>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 5, letterSpacing: '.1em' }}>配色</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {swatches.map((c, i) => (
              <span key={i} style={{ width: 18, height: 18, borderRadius: 5, background: c, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
            ))}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <SpecRow k="动效" v={motion} />
        </div>
      </div>
    </div>
  );
}
function SpecRow({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4, letterSpacing: '.1em' }}>{k}</div>
      <div style={{ fontSize: 12.5, color: '#444', lineHeight: 1.45 }}>{v}</div>
    </div>
  );
}

// account handle chip reused across frames
function Handle({ children, style }) {
  return <span style={style}>{children}</span>;
}

/* ════════════════════════════════════════════════════════
   01 · 活力撞色大字  POP PUNCH
   ════════════════════════════════════════════════════════ */
function F1() {
  const blue = '#2433ff', acid = '#eaff00', pink = '#ff2e88';
  return (
    <Frame bg={blue}>
      {/* halftone dots */}
      <div style={{ position: 'absolute', inset: 0, opacity: .14,
        backgroundImage: 'radial-gradient(#fff 1.4px, transparent 1.6px)', backgroundSize: '16px 16px' }} />
      {/* corner blocks */}
      <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, background: pink, transform: 'rotate(18deg)' }} />
      <div style={{ position: 'absolute', bottom: 120, left: -30, width: 120, height: 120, background: acid, borderRadius: '50%' }} />

      {/* top label */}
      <div style={{ position: 'absolute', top: 40, left: 28, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ background: acid, color: blue, fontFamily: "'Anton', sans-serif", fontSize: 15, padding: '4px 10px', letterSpacing: '.04em', transform: 'rotate(-3deg)', display: 'inline-block' }}>EP.07</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: '#fff', letterSpacing: '.1em' }}>// 美食探店</span>
      </div>

      {/* stacked smash title */}
      <div style={{ position: 'absolute', top: 172, left: 26, right: 26, fontFamily: "'ZCOOL QingKe HuangYou', sans-serif", lineHeight: .96 }}>
        <div style={{ display: 'inline-block', whiteSpace: 'nowrap', background: '#fff', color: blue, fontSize: 84, padding: '2px 12px', transform: 'rotate(-2deg)' }}>今天</div>
        <div style={{ marginTop: 12 }}>
          <span style={{ display: 'inline-block', whiteSpace: 'nowrap', background: acid, color: '#111', fontSize: 84, padding: '2px 12px', transform: 'rotate(1.5deg)' }}>到底</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <span style={{ display: 'inline-block', whiteSpace: 'nowrap', background: pink, color: '#fff', fontSize: 72, padding: '2px 12px', transform: 'rotate(-1deg)' }}>吃什么</span>
        </div>
      </div>

      {/* arrow burst */}
      <div style={{ position: 'absolute', bottom: 150, right: 30, fontFamily: "'Anton', sans-serif", color: acid, fontSize: 60, transform: 'rotate(-8deg)', textShadow: `4px 4px 0 ${pink}` }}>!?</div>

      {/* handle */}
      <div style={{ position: 'absolute', bottom: 52, left: 28, display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: acid, display: 'inline-block', boxShadow: '0 0 0 2px #fff' }} />
        <span style={{ fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 800, fontSize: 17, color: '#fff' }}>@你的ID</span>
      </div>
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════
   02 · 高级黑白极简  MINIMAL MONO
   ════════════════════════════════════════════════════════ */
function F2() {
  const ink = '#15140f', paper = '#f4f2ec';
  return (
    <Frame bg={paper}>
      <div style={{ position: 'absolute', inset: 0, color: ink }}>
        {/* timecode corner */}
        <div style={{ position: 'absolute', top: 34, left: 30, fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.12em', color: ink, opacity: .55 }}>REC ● 00:00:03:00</div>
        <div style={{ position: 'absolute', top: 34, right: 30, fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.12em', color: ink, opacity: .55 }}>9:16</div>

        {/* center lockup */}
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center' }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.5em', color: ink, opacity: .5, marginBottom: 26, paddingLeft: '.5em' }}>A QUIET LIFE</div>
          <div style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 300, fontSize: 96, letterSpacing: '.28em', color: ink, paddingLeft: '.28em' }}>日常</div>
          {/* hairline */}
          <div style={{ width: 64, height: 1, background: ink, margin: '30px auto 0', opacity: .8 }} />
          <div style={{ fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 300, fontSize: 13, letterSpacing: '.34em', color: ink, opacity: .65, marginTop: 22, paddingLeft: '.34em' }}>VOL · 01</div>
        </div>

        {/* bottom handle */}
        <div style={{ position: 'absolute', bottom: 44, left: 0, right: 0, textAlign: 'center', fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: '.2em', color: ink, opacity: .6 }}>@你的ID</div>
      </div>
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════
   03 · 赛博故障霓虹  CYBER GLITCH
   ════════════════════════════════════════════════════════ */
function F3() {
  const cyan = '#1ff0ff', mag = '#ff1 fd'.replace(' ', ''), bg = '#06070d';
  const magenta = '#ff21d0';
  return (
    <Frame bg={bg}>
      {/* perspective grid horizon */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 280, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: '0 -50% -2px', backgroundImage:
          `linear-gradient(${cyan} 1px, transparent 1px), linear-gradient(90deg, ${cyan} 1px, transparent 1px)`,
          backgroundSize: '40px 40px', transform: 'perspective(220px) rotateX(62deg)', transformOrigin: 'bottom', opacity: .5 }} />
      </div>
      {/* glow blob */}
      <div style={{ position: 'absolute', top: 120, left: '50%', width: 320, height: 320, transform: 'translateX(-50%)', background: `radial-gradient(circle, ${magenta}33, transparent 65%)` }} />

      {/* top sys line */}
      <div style={{ position: 'absolute', top: 40, left: 26, right: 26, display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.18em', color: cyan }}>
        <span>SYSTEM //</span><span style={{ color: magenta }}>● ONLINE</span>
      </div>

      {/* RGB-split title */}
      <div style={{ position: 'absolute', top: 250, left: 0, right: 0, textAlign: 'center' }}>
        <GlitchWord text="未来" cyan={cyan} mag={magenta} />
        <GlitchWord text="已来" cyan={cyan} mag={magenta} />
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: '.42em', color: '#fff', marginTop: 16, paddingLeft: '.42em', opacity: .9 }}>THE FUTURE IS NOW</div>
      </div>

      {/* glitch bars */}
      <div style={{ position: 'absolute', top: 300, left: 0, right: 0, height: 8, background: cyan, opacity: .25, transform: 'translateX(6px)' }} />
      <div style={{ position: 'absolute', top: 366, left: 30, width: 120, height: 5, background: magenta, opacity: .5 }} />

      {/* scanlines */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(transparent 0 2px, rgba(0,0,0,.32) 2px 4px)', pointerEvents: 'none' }} />

      {/* handle */}
      <div style={{ position: 'absolute', bottom: 46, left: 0, right: 0, textAlign: 'center', fontFamily: "'Space Mono', monospace", fontSize: 13, letterSpacing: '.2em', color: cyan }}>@你的ID</div>
    </Frame>
  );
}
function GlitchWord({ text, cyan, mag }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block', fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 900, fontSize: 92, lineHeight: 1.02, color: '#fff' }}>
      <span style={{ position: 'absolute', left: -3, top: 1, color: mag, opacity: .85 }}>{text}</span>
      <span style={{ position: 'absolute', left: 3, top: -1, color: cyan, opacity: .85 }}>{text}</span>
      <span style={{ position: 'relative' }}>{text}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   04 · 复古胶片  RETRO FILM
   ════════════════════════════════════════════════════════ */
function F4() {
  const cream = '#e9dcc0', ink = '#2c2417', red = '#c9402e';
  return (
    <Frame bg={cream}>
      {/* warm vignette */}
      <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 140px 30px rgba(60,40,10,.4)' }} />
      {/* light leak */}
      <div style={{ position: 'absolute', top: -60, right: -60, width: 260, height: 360, background: 'radial-gradient(circle at 70% 30%, rgba(255,120,40,.7), transparent 60%)', mixBlendMode: 'screen' }} />
      {/* sprocket strips */}
      {['left', 'right'].map((s) => (
        <div key={s} style={{ position: 'absolute', top: 0, bottom: 0, [s]: 0, width: 26, background: 'rgba(20,16,8,.82)', display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center', paddingTop: 8, paddingBottom: 8 }}>
          {Array.from({ length: 11 }).map((_, i) => (
            <span key={i} style={{ width: 12, height: 16, background: cream, borderRadius: 2, opacity: .85 }} />
          ))}
        </div>
      ))}

      {/* date stamp */}
      <div style={{ position: 'absolute', top: 38, right: 44, fontFamily: "'Space Mono', monospace", fontSize: 19, color: red, letterSpacing: '.04em', textShadow: '0 0 8px rgba(201,64,46,.5)' }}>'26 ▸ 07 ▸ 14</div>

      {/* photo inset 4:3 */}
      <div style={{ position: 'absolute', top: 150, left: 52, right: 52, height: 250, padding: 8, background: '#fff', boxShadow: '0 8px 22px rgba(0,0,0,.25)', transform: 'rotate(-1.5deg)' }}>
        <Photo label="[ 你的画面 · 4:3 ]" style={{ width: '100%', height: '100%' }} />
      </div>

      {/* title */}
      <div style={{ position: 'absolute', bottom: 160, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ fontFamily: "'Ma Shan Zheng', cursive", fontSize: 70, color: ink, lineHeight: 1 }}>夏日回忆</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: '.34em', color: ink, opacity: .7, marginTop: 14, paddingLeft: '.34em' }}>FILM 400 · SUMMER</div>
      </div>

      {/* handle */}
      <div style={{ position: 'absolute', bottom: 56, left: 0, right: 0, textAlign: 'center', fontFamily: "'Noto Serif SC', serif", fontSize: 14, letterSpacing: '.18em', color: ink, opacity: .75 }}>@你的ID</div>

      {/* grain */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: GRAIN, opacity: .35, mixBlendMode: 'multiply', pointerEvents: 'none' }} />
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════
   05 · 弥散渐变光感  AURORA GLOW
   ════════════════════════════════════════════════════════ */
function F5() {
  const v = '#7b5cff', m = '#ff5cb0', c = '#38e8ff', o = '#ffb877';
  const bg =
    `radial-gradient(60% 48% at 22% 24%, ${m}cc 0%, transparent 60%),` +
    `radial-gradient(56% 46% at 82% 18%, ${v}e6 0%, transparent 60%),` +
    `radial-gradient(64% 54% at 80% 80%, ${c}b3 0%, transparent 58%),` +
    `radial-gradient(58% 50% at 16% 88%, ${o}aa 0%, transparent 58%),` +
    `linear-gradient(160deg, #241b54, #0f0b2e)`;
  return (
    <Frame bg={bg}>
      {/* top sheen */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 70% at 50% -10%, rgba(255,255,255,.20), transparent 55%)' }} />

      {/* top kicker */}
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, textAlign: 'center', fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.36em', color: 'rgba(255,255,255,.82)', paddingLeft: '.36em' }}>NEW SERIES · 2026</div>

      {/* frosted glass card */}
      <div style={{ position: 'absolute', top: '50%', left: 32, right: 32, transform: 'translateY(-50%)', padding: '48px 30px', borderRadius: 32, background: 'rgba(255,255,255,.13)', border: '1px solid rgba(255,255,255,.42)', boxShadow: '0 24px 70px rgba(15,8,46,.5), inset 0 1px 0 rgba(255,255,255,.55)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', textAlign: 'center' }}>
        <div style={{ width: 50, height: 50, margin: '0 auto 24px', borderRadius: '50%', background: 'linear-gradient(135deg, #ffffff, rgba(255,255,255,.55))', boxShadow: `0 0 34px ${c}, 0 0 14px #fff` }} />
        <div style={{ fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 900, fontSize: 66, lineHeight: 1.06, color: '#fff', letterSpacing: '.06em', textShadow: '0 2px 24px rgba(0,0,0,.28)' }}>全新<br />企划</div>
        <div style={{ margin: '24px auto 0', width: 56, height: 1, background: 'rgba(255,255,255,.5)' }} />
        <div style={{ fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 300, fontSize: 14, letterSpacing: '.34em', color: 'rgba(255,255,255,.88)', marginTop: 18, paddingLeft: '.34em' }}>正式上线</div>
      </div>

      {/* handle */}
      <div style={{ position: 'absolute', bottom: 48, left: 0, right: 0, textAlign: 'center', fontFamily: "'Space Mono', monospace", fontSize: 13, letterSpacing: '.22em', color: 'rgba(255,255,255,.9)' }}>@你的ID</div>
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════
   06 · 杂志编辑封面  EDITORIAL
   ════════════════════════════════════════════════════════ */
function F6() {
  const ink = '#141414', paper = '#efede7', red = '#e23b2e';
  return (
    <Frame bg={paper}>
      <div style={{ position: 'absolute', inset: 0, color: ink }}>
        {/* giant ghost issue number */}
        <div style={{ position: 'absolute', right: -22, bottom: 64, fontFamily: "'Bebas Neue', sans-serif", fontSize: 380, lineHeight: .8, color: 'rgba(20,20,20,.05)', letterSpacing: '-.02em' }}>07</div>

        {/* masthead bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 54, background: ink, color: paper, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.16em' }}>
          <span>ISSUE Nº07</span><span>时尚 / FASHION</span>
        </div>

        {/* kicker */}
        <div style={{ position: 'absolute', top: 92, left: 30, fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.28em', color: red }}>SPRING EDITORIAL —</div>

        {/* stacked serif headline */}
        <div style={{ position: 'absolute', top: 132, left: 28, right: 28, fontFamily: "'Noto Serif SC', serif", fontWeight: 700, lineHeight: 1.0 }}>
          <div style={{ fontSize: 80 }}>本季</div>
          <div style={{ fontSize: 80, marginTop: 4 }}>最值得</div>
          <div style={{ fontSize: 80, marginTop: 4, color: red, fontStyle: 'italic' }}>入手</div>
        </div>

        {/* red rule */}
        <div style={{ position: 'absolute', top: 442, left: 30, right: 30, height: 3, background: red }} />

        {/* two-column dek */}
        <div style={{ position: 'absolute', top: 462, left: 30, right: 30, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 300, fontSize: 11.5, lineHeight: 1.7, color: 'rgba(20,20,20,.72)' }}>
          <div>当季单品全解析，从面料到细节，一支视频替你划好重点。</div>
          <div>P.07 · 封面故事 · 拍摄 @你的ID · 本期主题「春日序章」。</div>
        </div>

        {/* bottom bar */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 46, borderTop: `1px solid ${ink}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '.14em', color: ink }}>
          <span>@你的ID</span><span>VOL.07 — 2026</span>
        </div>
      </div>
    </Frame>
  );
}

/* ── compose frame + spec into one artboard child ─────────── */
function Slate({ frame, spec }) {
  return <div style={{ width: FW, background: '#fff' }}>{frame}{spec}</div>;
}

Object.assign(window, {
  FW, FH, Slate, Spec, F1, F2, F3, F4, F5, F6,
});
