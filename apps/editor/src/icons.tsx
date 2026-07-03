// Minimal inline SVG icon set (24px viewBox, stroke = currentColor).
const P: Record<string, JSX.Element> = {
  play: <path d="M7 4.5 19 12 7 19.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></>,
  skipStart: <><path d="M18 5v14L8 12Z" fill="currentColor" stroke="none" /><rect x="5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  prevFrame: <><path d="M15 6.5 9 12l6 5.5" /><path d="M9 6.5v11" /></>,
  nextFrame: <><path d="M9 6.5 15 12l-6 5.5" /><path d="M15 6.5v11" /></>,
  loop: <><path d="M4 12a6 6 0 0 1 6-6h9" /><path d="M16.5 3.5 19 6l-2.5 2.5" /><path d="M20 12a6 6 0 0 1-6 6H5" /><path d="M7.5 20.5 5 18l2.5-2.5" /></>,
  undo: <><path d="M8.5 5.5 4.5 9.5l4 4" /><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" /></>,
  redo: <><path d="M15.5 5.5 19.5 9.5l-4 4" /><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3" /></>,
  save: <><path d="M5 4h11l3 3v13H5Z" /><path d="M8 4v5h7V4" /><rect x="8" y="13" width="8" height="7" /></>,
  open: <><path d="M4 7V5h6l2 2h8v3" /><path d="M4 7h16l-2 12H4Z" /></>,
  file: <><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v4h4" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  trash: <><path d="M5 7h14" /><path d="M9 7V4h6v3" /><path d="M7 7l1 13h8l1-13" /></>,
  dup: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 4H6a2 2 0 0 0-2 2v10" /></>,
  up: <path d="M6 14l6-6 6 6" />,
  down: <path d="M6 10l6 6 6-6" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  chevR: <path d="M9 6l6 6-6 6" />,
  chevD: <path d="M6 9l6 6 6-6" />,
  export: <><path d="M12 15V3" /><path d="M7.5 7.5 12 3l4.5 4.5" /><path d="M4 14v6h16v-6" /></>,
  json: <><path d="M9 4c-2 0-2.5 1-2.5 2.5S7 9 5.5 9.5C7 10 6.5 11.5 6.5 13S7 15.5 9 15.5" transform="translate(0 2.2)" /><path d="M15 4c2 0 2.5 1 2.5 2.5S17 9 18.5 9.5C17 10 17.5 11.5 17.5 13s-.5 2.5-2.5 2.5" transform="translate(0 2.2)" /></>,
  rect: <rect x="4" y="6.5" width="16" height="11" rx="1.5" />,
  circle: <circle cx="12" cy="12" r="8" />,
  text: <><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17.5 9.5 13l3.5 3 3-2.5 4 4" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5 21 7.5v9l-5-3" /></>,
  audio: <><path d="M4 10v4h4l5 4V6l-5 4Z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></>,
  group: <><rect x="4" y="4" width="9" height="9" rx="1.5" /><rect x="11" y="11" width="9" height="9" rx="1.5" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c3 2.6 3 14.4 0 17M12 3.5c-3 2.6-3 14.4 0 17" /></>,
  map: <><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2Z" /><path d="M9 4v14" /><path d="M15 6v14" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 2" /><path d="M9.5 3h5" /></>,
  curtain: <><path d="M4 4h16v16" /><path d="M4 4v16h16" /><path d="M4 4c4 5 4 11 0 16M20 4c-4 5-4 11 0 16" /></>,
  sweep: <><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  camera: <><rect x="3.5" y="7" width="17" height="12" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M9 7l1.2-2h3.6L15 7" /></>,
  warn: <><path d="M12 4 2.5 20h19Z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.4" r="0.4" fill="currentColor" /></>,
  check: <path d="M5 12.5 10 17.5 19 7" />,
  fit: <><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>,
  diamond: <rect x="8" y="8" width="8" height="8" transform="rotate(45 12 12)" fill="currentColor" stroke="none" />,
  caption: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7 15h6" /><path d="M15.5 15H17" /></>,
  svgFile: <><path d="M4 12c2-5 6-5 8 0s6 5 8 0" /><circle cx="4" cy="12" r="1.4" /><circle cx="20" cy="12" r="1.4" /></>,
  sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" /></>,
  moon: <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 7.5 7.5 0 1 0 20 13.5Z" />
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

export const PLUGIN_ICONS: Record<string, { icon: string; tint: string }> = {
  "curtain-open": { icon: "curtain", tint: "linear-gradient(135deg,#e0475b,#8a2b6b)" },
  "ken-burns": { icon: "camera", tint: "linear-gradient(135deg,#3fb96f,#1c7a6a)" },
  "glitch-title": { icon: "sparkle", tint: "linear-gradient(135deg,#c04dff,#5b2bd6)" },
  "map-route": { icon: "map", tint: "linear-gradient(135deg,#e8a13d,#c05621)" },
  "globe-intro": { icon: "globe", tint: "linear-gradient(135deg,#4d8dff,#1e4fd1)" },
  "globe-route": { icon: "globe", tint: "linear-gradient(135deg,#22d3ee,#0e7fa8)" },
  "countdown": { icon: "timer", tint: "linear-gradient(135deg,#f2c94c,#c98a1e)" },
  "light-sweep-title": { icon: "sweep", tint: "linear-gradient(135deg,#7b5cff,#4d8dff)" }
};
export const pluginIcon = (name: string): { icon: string; tint: string } =>
  PLUGIN_ICONS[name] ?? { icon: "sparkle", tint: "linear-gradient(135deg,#6d7cff,#22d3ee)" };
