// Easing primitives shared by the keyframe IR (per-keyframe easing) and the
// transition DSL. The render engine only interpolates linearly between
// resolved values, so non-linear easings are applied either per keyframe
// segment (see resolveScalar) or baked into sampled keyframes (see
// transitions.ts).

export type EasingFn = (t: number) => number;

// A CSS-style cubic-bezier control-point spec [x1, y1, x2, y2]. Serializable
// (unlike an EasingFn), so it can live in a keyframe IR that crosses a
// JSON/worker boundary, while still giving frame-precise curve control.
export type CubicBezierPoints = readonly [number, number, number, number];

// Named easing presets.
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInSine"
  | "easeOutSine"
  | "easeInOutSine"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack"
  | "easeOutElastic"
  | "easeOutBounce";

// A value usable anywhere an easing is accepted: a named preset, a custom
// function, or a cubic-bezier control-point tuple.
export type EasingLike = Easing | EasingFn | CubicBezierPoints;

const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;
const ELASTIC_C = (2 * Math.PI) / 3;

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  }
  if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  }
  if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  }
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

const EASINGS: Record<Exclude<Easing, "linear">, EasingFn> = {
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeInQuart: (t) => t ** 4,
  easeOutQuart: (t) => 1 - (1 - t) ** 4,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInOutExpo: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
  },
  easeInBack: (t) => BACK_C3 * t ** 3 - BACK_C1 * t ** 2,
  easeOutBack: (t) => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2,
  easeInOutBack: (t) =>
    t < 0.5
      ? ((2 * t) ** 2 * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
      : ((2 * t - 2) ** 2 * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2,
  easeOutElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C) + 1;
  },
  easeOutBounce
};

// Newton-Raphson + bisection cubic-bezier solver, matching the CSS
// `cubic-bezier()` timing function. x1/x2 are clamped to [0,1] (the curve must
// be a function of time); y values are unconstrained so the curve can
// overshoot (anticipation / overshoot landings).
const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 1e-3;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 12;

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  for (const value of [x1, y1, x2, y2]) {
    if (!Number.isFinite(value)) {
      throw new Error("cubicBezier control points must be finite numbers");
    }
  }
  const cx1 = clamp01(x1);
  const cx2 = clamp01(x2);

  // Linear shortcut when both control points sit on the diagonal.
  if (cx1 === y1 && cx2 === y2) {
    return (t) => t;
  }

  const sampleCurve = (a: number, b: number, t: number): number =>
    ((curveA(a, b) * t + curveB(a, b)) * t + curveC(a)) * t;
  const sampleDerivative = (a: number, b: number, t: number): number =>
    (3 * curveA(a, b) * t + 2 * curveB(a, b)) * t + curveC(a);

  const solveForT = (x: number): number => {
    let guess = x;
    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const slope = sampleDerivative(cx1, cx2, guess);
      if (Math.abs(slope) < NEWTON_MIN_SLOPE) {
        break;
      }
      const currentX = sampleCurve(cx1, cx2, guess) - x;
      guess -= currentX / slope;
    }
    // Bisection fallback keeps the solver robust where the slope vanishes.
    let lo = 0;
    let hi = 1;
    let t = x;
    if (t < lo) return lo;
    if (t > hi) return hi;
    for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i++) {
      const currentX = sampleCurve(cx1, cx2, t);
      if (Math.abs(currentX - x) < SUBDIVISION_PRECISION) {
        return t;
      }
      if (currentX < x) {
        lo = t;
      } else {
        hi = t;
      }
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleCurve(y1, y2, solveForT(t));
  };
}

function curveA(a: number, b: number): number {
  return 1 - 3 * b + 3 * a;
}
function curveB(a: number, b: number): number {
  return 3 * b - 6 * a;
}
function curveC(a: number): number {
  return 3 * a;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Resolve a named preset, custom function, or cubic-bezier tuple to an easing
// function. `undefined` and "linear" return `undefined` — callers treat that as
// "no easing needed" and interpolate linearly (no baking / no extra work).
export function resolveEasing(easing?: EasingLike): EasingFn | undefined {
  if (easing === undefined || easing === "linear") {
    return undefined;
  }
  if (typeof easing === "function") {
    return easing;
  }
  if (Array.isArray(easing)) {
    return cubicBezier(easing[0]!, easing[1]!, easing[2]!, easing[3]!);
  }
  return EASINGS[easing as Exclude<Easing, "linear">];
}
