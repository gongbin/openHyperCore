import { defineComposition } from "./composition.ts";
import type { Composition, Layer, ShapeLayer, TextLayer } from "./types.ts";

export type FullFrameEffectOptions = {
  id?: string;
  width: number;
  height: number;
  startMs: number;
  durationMs?: number;
  endMs?: number;
  color?: string;
};

export type CinematicBarsOptions = {
  id?: string;
  width: number;
  height: number;
  startMs: number;
  endMs: number;
  barHeight?: number;
  color?: string;
  opacity?: number;
};

export type FlashTransitionOptions = FullFrameEffectOptions & {
  peakOpacity?: number;
};

export type SpeedLineBurstOptions = {
  id?: string;
  width: number;
  height: number;
  startMs: number;
  endMs: number;
  count?: number;
  seed?: number;
  colors?: string[];
  direction?: "down" | "up";
};

export type GlitchTitleOptions = {
  id?: string;
  text: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  size: number;
  color?: string;
  accentA?: string;
  accentB?: string;
  stroke?: string;
};

export type TimelineContext = {
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
};

export type TimelineMarker = {
  startMs: number;
  endMs: number;
  durationMs: number;
};

export type TimelineBuild = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  layers: Layer[];
  markers: Record<string, TimelineMarker>;
  composition: Composition;
};

type TimelineLayerFactory = (context: TimelineContext) => Layer[];

export function cinematicBars(options: CinematicBarsOptions): ShapeLayer[] {
  const id = options.id ?? "cinematic-bars";
  const barHeight = options.barHeight ?? Math.round(options.height * 0.12);
  const fill = options.color ?? "rgba(0,0,0,0.86)";
  const opacity = options.opacity ?? 1;
  const base = {
    type: "shape" as const,
    shape: "rect" as const,
    width: options.width,
    height: barHeight,
    fill,
    startMs: options.startMs,
    endMs: options.endMs
  };

  return [
    {
      ...base,
      id: `${id}-top`,
      transform: { x: 0, y: 0, opacity }
    },
    {
      ...base,
      id: `${id}-bottom`,
      transform: { x: 0, y: options.height - barHeight, opacity }
    }
  ];
}

export function flashTransitionLayer(options: FlashTransitionOptions): ShapeLayer {
  const durationMs = options.durationMs ?? Math.max(1, (options.endMs ?? options.startMs + 220) - options.startMs);
  const endMs = options.endMs ?? options.startMs + durationMs;
  const peakAt = options.startMs + Math.round(durationMs * 0.2);
  const fallAt = options.startMs + Math.round(durationMs * 0.5);

  return {
    type: "shape",
    id: options.id ?? "flash-transition",
    shape: "rect",
    width: options.width,
    height: options.height,
    fill: options.color ?? "#ffffff",
    startMs: options.startMs,
    endMs,
    transform: {
      opacity: [
        { timeMs: options.startMs, value: 0 },
        { timeMs: peakAt, value: options.peakOpacity ?? 0.92 },
        { timeMs: fallAt, value: 0.18 },
        { timeMs: endMs, value: 0 }
      ]
    }
  };
}

export function speedLineBurst(options: SpeedLineBurstOptions): ShapeLayer[] {
  const count = options.count ?? 14;
  const colors = options.colors ?? ["rgba(255,255,255,0.72)", "rgba(255,183,3,0.78)", "rgba(33,158,188,0.72)"];
  const id = options.id ?? "speed-line";
  const random = seededRandom(options.seed ?? 1);
  const down = options.direction !== "up";

  return Array.from({ length: count }, (_, index) => {
    const x = Math.round(random() * options.width);
    const length = Math.round(options.height * (0.18 + random() * 0.32));
    const thickness = 3 + Math.round(random() * 6);
    const drift = (random() - 0.5) * options.width * 0.22;
    const yStart = down ? -length - random() * options.height * 0.5 : options.height + random() * options.height * 0.5;
    const yEnd = down ? options.height + random() * options.height * 0.35 : -length - random() * options.height * 0.35;
    const startMs = options.startMs;
    const endMs = options.endMs;

    return {
      type: "shape",
      id: `${id}-${index}`,
      shape: "rect",
      width: thickness,
      height: length,
      fill: colors[index % colors.length]!,
      startMs,
      endMs,
      transform: {
        x: [
          { timeMs: startMs, value: x },
          { timeMs: endMs, value: x + drift }
        ],
        y: [
          { timeMs: startMs, value: yStart },
          { timeMs: endMs, value: yEnd }
        ],
        rotate: down ? -12 - random() * 14 : 12 + random() * 14,
        opacity: [
          { timeMs: startMs, value: 0 },
          { timeMs: startMs + 120, value: 0.92 },
          { timeMs: Math.max(startMs + 140, endMs - 160), value: 0.72 },
          { timeMs: endMs, value: 0 }
        ]
      }
    };
  });
}

export function glitchTitle(options: GlitchTitleOptions): Layer[] {
  const id = options.id ?? "glitch-title";
  const color = options.color ?? "#ffffff";
  const accentA = options.accentA ?? "#8ecae6";
  const accentB = options.accentB ?? "#ff006e";
  const baseOpacity = [
    { timeMs: options.startMs, value: 0 },
    { timeMs: options.startMs + 120, value: 1 },
    { timeMs: options.startMs + 360, value: 0.32 },
    { timeMs: options.startMs + 430, value: 1 },
    { timeMs: Math.max(options.startMs + 500, options.endMs - 180), value: 1 },
    { timeMs: options.endMs, value: 0 }
  ];
  const main: TextLayer = {
    type: "text",
    id,
    text: options.text,
    size: options.size,
    color,
    stroke: options.stroke ?? "rgba(0,0,0,0.62)",
    strokeWidth: Math.max(3, Math.round(options.size * 0.05)),
    shadowColor: "rgba(0,0,0,0.72)",
    shadowBlur: Math.max(6, Math.round(options.size * 0.12)),
    shadowDy: Math.round(options.size * 0.08),
    startMs: options.startMs,
    endMs: options.endMs,
    transform: { x: options.x, y: options.y, opacity: baseOpacity }
  };

  return [
    main,
    glitchTextLayer(id, "cyan", options, accentA, -8, -3),
    glitchTextLayer(id, "magenta", options, accentB, 9, 4),
    glitchBar(id, 0, options, accentA, -0.52),
    glitchBar(id, 1, options, accentB, 0.18)
  ];
}

function glitchTextLayer(id: string, suffix: string, options: GlitchTitleOptions, color: string, dx: number, dy: number): TextLayer {
  return {
    type: "text",
    id: `${id}-${suffix}`,
    text: options.text,
    size: options.size,
    color,
    startMs: options.startMs + 70,
    endMs: Math.min(options.endMs, options.startMs + 720),
    transform: {
      x: [
        { timeMs: options.startMs + 70, value: options.x + dx },
        { timeMs: options.startMs + 210, value: options.x - dx },
        { timeMs: options.startMs + 360, value: options.x + dx / 2 }
      ],
      y: options.y + dy,
      opacity: [
        { timeMs: options.startMs + 70, value: 0 },
        { timeMs: options.startMs + 140, value: 0.72 },
        { timeMs: options.startMs + 430, value: 0.16 },
        { timeMs: Math.min(options.endMs, options.startMs + 720), value: 0 }
      ]
    }
  };
}

function glitchBar(id: string, index: number, options: GlitchTitleOptions, fill: string, yFactor: number): ShapeLayer {
  const startMs = options.startMs + 180 + index * 90;
  return {
    type: "shape",
    id: `${id}-slice-${index}`,
    shape: "rect",
    width: Math.round(options.text.length * options.size * 0.52),
    height: Math.max(4, Math.round(options.size * 0.08)),
    fill,
    startMs,
    endMs: Math.min(options.endMs, startMs + 360),
    transform: {
      x: [
        { timeMs: startMs, value: options.x - 24 },
        { timeMs: startMs + 120, value: options.x + 34 },
        { timeMs: startMs + 360, value: options.x - 12 }
      ],
      y: options.y + Math.round(options.size * yFactor),
      opacity: [
        { timeMs: startMs, value: 0 },
        { timeMs: startMs + 70, value: 0.86 },
        { timeMs: startMs + 230, value: 0.18 },
        { timeMs: startMs + 360, value: 0 }
      ]
    }
  };
}

export function createTimeline(options: { width: number; height: number; fps: number }): TimelineBuilder {
  return new TimelineBuilder(options.width, options.height, options.fps);
}

export class TimelineBuilder {
  readonly #width: number;
  readonly #height: number;
  readonly #fps: number;
  readonly #layers: Layer[] = [];
  readonly #markers: Record<string, TimelineMarker> = {};
  #cursorMs = 0;

  constructor(width: number, height: number, fps: number) {
    this.#width = width;
    this.#height = height;
    this.#fps = fps;
  }

  scene(name: string, durationMs: number, factory: TimelineLayerFactory): this {
    return this.#segment(name, durationMs, factory);
  }

  transition(name: string, durationMs: number, factory: TimelineLayerFactory): this {
    return this.#segment(name, durationMs, factory);
  }

  build(): TimelineBuild {
    const composition = defineComposition({
      fps: this.#fps,
      width: this.#width,
      height: this.#height,
      durationMs: this.#cursorMs,
      layers: this.#layers
    });
    return {
      width: this.#width,
      height: this.#height,
      fps: this.#fps,
      durationMs: this.#cursorMs,
      layers: this.#layers,
      markers: this.#markers,
      composition
    };
  }

  #segment(name: string, durationMs: number, factory: TimelineLayerFactory): this {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error("timeline segment durationMs must be positive");
    }
    const startMs = this.#cursorMs;
    const endMs = startMs + durationMs;
    this.#markers[name] = { startMs, endMs, durationMs };
    this.#layers.push(...factory({
      name,
      startMs,
      endMs,
      durationMs,
      width: this.#width,
      height: this.#height,
      fps: this.#fps
    }));
    this.#cursorMs = endMs;
    return this;
  }
}

function seededRandom(seed: number): () => number {
  let state = Math.max(1, Math.floor(seed)) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
