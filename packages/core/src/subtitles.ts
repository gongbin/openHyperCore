import type { CaptionLayer } from "./types.ts";

export type SubtitleCue = {
  startMs: number;
  endMs: number;
  text: string;
};

// Parse a single SRT/VTT timestamp ("HH:MM:SS,mmm", "HH:MM:SS.mmm" or
// "MM:SS.mmm") into milliseconds. Returns undefined for malformed input.
function parseTimestamp(token: string): number | undefined {
  const parts = token.trim().replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) {
    return undefined;
  }
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  const seconds = parts.length === 3
    ? (nums[0]! * 60 + nums[1]!) * 60 + nums[2]!
    : nums[0]! * 60 + nums[1]!;
  return Math.round(seconds * 1000);
}

// Parse a "start --> end [cue settings]" line, ignoring any trailing VTT cue
// settings (e.g. "align:center line:90%").
function parseTimingLine(line: string): { startMs: number; endMs: number } | undefined {
  const [left, right] = line.split("-->");
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const startMs = parseTimestamp(left);
  const endMs = parseTimestamp(right.trim().split(/\s+/)[0] ?? "");
  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }
  return { startMs, endMs };
}

// Parse SRT or WebVTT subtitle text into timed cues. The format is
// auto-detected, so the same function handles both. Cue identifiers, the
// `WEBVTT` header, and `NOTE`/`STYLE`/`REGION` blocks are skipped.
export function parseSubtitles(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.replace(/\s+$/, ""));
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) {
      continue;
    }
    const first = lines[0]?.trim() ?? "";
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(first) && timingIndex === 0) {
      continue;
    }
    const timing = parseTimingLine(lines[timingIndex]!);
    if (!timing) {
      continue;
    }
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (text === "") {
      continue;
    }
    cues.push({ startMs: timing.startMs, endMs: timing.endMs, text });
  }

  return cues;
}

export type SubtitleCaptionOptions = Omit<CaptionLayer, "type" | "text" | "startMs" | "endMs">;

// Turn parsed cues into timed CaptionLayers, applying shared styling. Each
// caption is shown for its cue's [startMs, endMs) window via layer timing.
export function subtitlesToCaptions(cues: SubtitleCue[], base: SubtitleCaptionOptions = {}): CaptionLayer[] {
  return cues.map((cue) => ({
    ...base,
    type: "caption",
    text: cue.text,
    startMs: cue.startMs,
    endMs: cue.endMs
  }));
}
