// Shade a hex color toward white (amount > 0) or black (amount < 0), amount
// in -1..1. Non-hex inputs are returned unchanged (plugins accept any CSS
// color, but fold/highlight math needs channels, which only hex gives us).
export function shade(color: string, amount: number): string {
  const hex = normalizeHex(color);
  if (!hex) {
    return color;
  }
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const mix = (channel: number): number => Math.round(channel + (target - channel) * t);
  const [r, g, b] = hex;
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

function normalizeHex(color: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m || !m[1]) {
    return undefined;
  }
  const raw = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}
