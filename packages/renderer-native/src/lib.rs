//! Native (Rust + skia-safe) render backend for OpenHyperCore.
//!
//! The whole `ResolvedFrame` (already plain numeric data on the TS side) is
//! handed across the napi boundary once per frame as JSON and drawn natively,
//! returning a single RGBA8888 (unpremultiplied) buffer. This eliminates the
//! per-primitive JS<->native crossings and the per-frame readback copy that the
//! canvaskit-wasm path pays.
//!
//! Phase 1: shapes (rect/circle/path) with transform, solid fill, stroke, dash.
//! Phase 2: text + captions with per-character font fallback (CJK/emoji),
//!          wrapping, alignment, styled shadow/stroke/fill — mirroring the wasm
//!          renderer's algorithm so golden output matches.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde::Deserialize;
use skia_safe::font::Edging;
use skia_safe::paint::{Cap, Join};
use skia_safe::{BlurStyle, Canvas, Color, Font, FontMgr, MaskFilter, Paint, PaintStyle, Path, PathEffect, Rect, Typeface};

// ---------------------------------------------------------------------------
// IR mirror (subset). Field names match the TS ResolvedFrame (camelCase).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompositionMeta {
    width: i32,
    height: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transform {
    x: f32,
    y: f32,
    scale: f32,
    scale_x: f32,
    scale_y: f32,
    rotate: f32,
    opacity: f32,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Fill {
    Solid(String),
    // Gradient objects land in Phase 3; matched but ignored for now so they
    // don't fail deserialization.
    #[allow(dead_code)]
    Other(serde_json::Value),
}

fn solid_or<'a>(fill: &'a Option<Fill>, fallback: &'a str) -> &'a str {
    match fill {
        Some(Fill::Solid(s)) => s.as_str(),
        _ => fallback,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShapeLayer {
    shape: String,
    #[serde(default)]
    width: Option<f32>,
    #[serde(default)]
    height: Option<f32>,
    #[serde(default)]
    radius: Option<f32>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    fill: Option<Fill>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    stroke_width: Option<f32>,
    #[serde(default)]
    dash: Option<Vec<f32>>,
    #[serde(default)]
    dash_phase: Option<f32>,
    transform: Transform,
}

// Shadow/stroke styling shared by text + captions.
#[derive(Default)]
struct TextStyle<'a> {
    stroke: Option<&'a str>,
    stroke_width: Option<f32>,
    shadow_color: Option<&'a str>,
    shadow_blur: Option<f32>,
    shadow_dx: Option<f32>,
    shadow_dy: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextLayer {
    text: String,
    #[serde(default)]
    font: Option<String>,
    #[serde(default)]
    size: Option<f32>,
    #[serde(default)]
    color: Option<Fill>,
    #[serde(default)]
    align: Option<String>,
    #[serde(default)]
    line_height: Option<f32>,
    #[serde(default)]
    max_width: Option<f32>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    stroke_width: Option<f32>,
    #[serde(default)]
    shadow_color: Option<String>,
    #[serde(default)]
    shadow_blur: Option<f32>,
    #[serde(default)]
    shadow_dx: Option<f32>,
    #[serde(default)]
    shadow_dy: Option<f32>,
    transform: Transform,
}

impl TextLayer {
    fn style(&self) -> TextStyle<'_> {
        TextStyle {
            stroke: self.stroke.as_deref(),
            stroke_width: self.stroke_width,
            shadow_color: self.shadow_color.as_deref(),
            shadow_blur: self.shadow_blur,
            shadow_dx: self.shadow_dx,
            shadow_dy: self.shadow_dy,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptionLayer {
    text: String,
    #[serde(default)]
    font: Option<String>,
    #[serde(default)]
    size: Option<f32>,
    #[serde(default)]
    color: Option<Fill>,
    #[serde(default)]
    background_color: Option<Fill>,
    #[serde(default)]
    padding: Option<f32>,
    #[serde(default)]
    align: Option<String>,
    #[serde(default)]
    line_height: Option<f32>,
    #[serde(default)]
    max_width: Option<f32>,
    #[serde(default)]
    stroke: Option<String>,
    #[serde(default)]
    stroke_width: Option<f32>,
    #[serde(default)]
    shadow_color: Option<String>,
    #[serde(default)]
    shadow_blur: Option<f32>,
    #[serde(default)]
    shadow_dx: Option<f32>,
    #[serde(default)]
    shadow_dy: Option<f32>,
    transform: Transform,
}

impl CaptionLayer {
    fn style(&self) -> TextStyle<'_> {
        TextStyle {
            stroke: self.stroke.as_deref(),
            stroke_width: self.stroke_width,
            shadow_color: self.shadow_color.as_deref(),
            shadow_blur: self.shadow_blur,
            shadow_dx: self.shadow_dx,
            shadow_dy: self.shadow_dy,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Layer {
    Shape(ShapeLayer),
    Text(TextLayer),
    Caption(CaptionLayer),
    // Every other layer type (image/video/group/audio) is skipped until its
    // phase lands.
    #[serde(other)]
    Unsupported,
}

impl Layer {
    fn transform(&self) -> Option<&Transform> {
        match self {
            Layer::Shape(s) => Some(&s.transform),
            Layer::Text(t) => Some(&t.transform),
            Layer::Caption(c) => Some(&c.transform),
            Layer::Unsupported => None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    composition: CompositionMeta,
    layers: Vec<Layer>,
}

// ---------------------------------------------------------------------------
// Fonts — per-character fallback stack [primary, emoji, default], mirroring the
// wasm renderer. Typefaces are cached by path across frames.
// ---------------------------------------------------------------------------

fn typeface_cache() -> &'static Mutex<HashMap<String, Option<Typeface>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Typeface>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn load_typeface_path(path: &str) -> Option<Typeface> {
    let mut cache = typeface_cache().lock().unwrap();
    if let Some(found) = cache.get(path) {
        return found.clone();
    }
    let typeface = std::fs::read(path)
        .ok()
        .and_then(|data| FontMgr::new().new_from_data(&data, None));
    cache.insert(path.to_string(), typeface.clone());
    typeface
}

fn first_existing(candidates: &[Option<String>]) -> Option<Typeface> {
    for candidate in candidates.iter().flatten() {
        if let Some(tf) = load_typeface_path(candidate) {
            return Some(tf);
        }
    }
    None
}

fn default_typeface() -> Option<Typeface> {
    let candidates = [
        std::env::var("OPENHYPERCORE_FONT").ok(),
        Some("/System/Library/Fonts/PingFang.ttc".into()),
        Some("/System/Library/Fonts/STHeiti Medium.ttc".into()),
        Some("/System/Library/Fonts/Hiragino Sans GB.ttc".into()),
        Some("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc".into()),
        Some("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc".into()),
        Some("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf".into()),
        Some("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf".into()),
        Some("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf".into()),
        Some("/System/Library/Fonts/Supplemental/Arial.ttf".into()),
        Some("/System/Library/Fonts/SFNS.ttf".into()),
    ];
    first_existing(&candidates).or_else(|| FontMgr::new().legacy_make_typeface(None, skia_safe::FontStyle::default()))
}

fn emoji_typeface() -> Option<Typeface> {
    let candidates = [
        std::env::var("OPENHYPERCORE_EMOJI_FONT").ok(),
        Some("/System/Library/Fonts/Apple Color Emoji.ttc".into()),
        Some("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf".into()),
        Some("/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf".into()),
        Some("/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf".into()),
    ];
    first_existing(&candidates)
}

// Build the [primary, emoji, default] font stack at `size`, de-duplicated by
// typeface identity.
fn font_stack(font: Option<&str>, size: f32) -> Vec<Font> {
    let primary = font.and_then(load_typeface_path).or_else(default_typeface);
    let typefaces = [primary, emoji_typeface(), default_typeface()];

    let mut seen: Vec<u32> = Vec::new();
    let mut fonts = Vec::new();
    for tf in typefaces.into_iter().flatten() {
        let id = tf.unique_id();
        if seen.contains(&id) {
            continue;
        }
        seen.push(id);
        let mut f = Font::new(tf, size);
        f.set_edging(Edging::AntiAlias);
        fonts.push(f);
    }
    fonts
}

struct Run {
    font_index: usize,
    text: String,
}

fn split_runs(stack: &[Font], text: &str) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for ch in text.chars() {
        let mut font_index = 0;
        for (i, font) in stack.iter().enumerate() {
            if font.unichar_to_glyph(ch as i32) != 0 {
                font_index = i;
                break;
            }
        }
        if let Some(last) = runs.last_mut() {
            if last.font_index == font_index {
                last.text.push(ch);
                continue;
            }
        }
        runs.push(Run { font_index, text: ch.to_string() });
    }
    runs
}

fn measure_run(font: &Font, text: &str) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    font.measure_str(text, None).0
}

fn measure_stack(stack: &[Font], text: &str) -> f32 {
    split_runs(stack, text)
        .iter()
        .map(|run| measure_run(&stack[run.font_index], &run.text))
        .sum()
}

fn draw_runs(canvas: &Canvas, runs: &[Run], stack: &[Font], x: f32, baseline: f32, paint: &Paint) {
    let mut cursor = x;
    for run in runs {
        let font = &stack[run.font_index];
        canvas.draw_str(&run.text, (cursor, baseline), font, paint);
        cursor += measure_run(font, &run.text);
    }
}

// ---------------------------------------------------------------------------
// Text layout — wrap + alignment matching the wasm renderer.
// ---------------------------------------------------------------------------

fn is_cjk(c: char) -> bool {
    let u = c as u32;
    (0x2E80..=0x9FFF).contains(&u) || (0x3000..=0x303F).contains(&u) || (0xFF00..=0xFFEF).contains(&u)
}

// Atomic wrap tokens: optional leading whitespace then either one CJK char or a
// run of non-space, non-CJK chars (a "word"). Mirrors the wasm WRAP_TOKEN regex.
fn wrap_tokens(paragraph: &str) -> Vec<String> {
    let chars: Vec<char> = paragraph.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break; // trailing whitespace forms no token
        }
        if is_cjk(chars[i]) {
            i += 1;
        } else {
            while i < chars.len() && !chars[i].is_whitespace() && !is_cjk(chars[i]) {
                i += 1;
            }
        }
        tokens.push(chars[start..i].iter().collect());
    }
    tokens
}

fn wrap_text(stack: &[Font], text: &str, max_width: Option<f32>) -> Vec<String> {
    let max_width = match max_width {
        Some(w) if w.is_finite() && w > 0.0 => w,
        _ => return text.split('\n').map(|s| s.to_string()).collect(),
    };
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        for token in wrap_tokens(paragraph) {
            let candidate = format!("{line}{token}");
            if !line.is_empty() && measure_stack(stack, &candidate) > max_width {
                lines.push(line);
                line = token.trim_start().to_string();
            } else {
                line = candidate;
            }
        }
        lines.push(line);
    }
    if lines.is_empty() {
        vec![String::new()]
    } else {
        lines
    }
}

fn line_x(align: Option<&str>, width: f32) -> f32 {
    match align {
        Some("center") => -width / 2.0,
        Some("right") => -width,
        _ => 0.0,
    }
}

fn fill_paint(color: &str, opacity: f32) -> Paint {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(PaintStyle::Fill);
    paint.set_color(parse_color(color, opacity));
    paint
}

// Shadow -> outline stroke -> fill, matching the wasm drawStyledText order.
fn draw_styled_text(
    canvas: &Canvas,
    text: &str,
    x: f32,
    baseline: f32,
    color: &str,
    opacity: f32,
    stack: &[Font],
    style: &TextStyle,
) {
    let runs = split_runs(stack, text);

    if let Some(shadow) = style.shadow_color {
        let mut paint = fill_paint(shadow, opacity);
        if let Some(blur) = MaskFilter::blur(BlurStyle::Normal, style.shadow_blur.unwrap_or(6.0).max(0.1), false) {
            paint.set_mask_filter(blur);
        }
        draw_runs(canvas, &runs, stack, x + style.shadow_dx.unwrap_or(0.0), baseline + style.shadow_dy.unwrap_or(4.0), &paint);
    }

    if let Some(stroke) = style.stroke {
        let mut paint = fill_paint(stroke, opacity);
        paint.set_style(PaintStyle::Stroke);
        paint.set_stroke_width(style.stroke_width.unwrap_or(4.0));
        paint.set_stroke_join(Join::Round);
        paint.set_stroke_cap(Cap::Round);
        draw_runs(canvas, &runs, stack, x, baseline, &paint);
    }

    let fill = fill_paint(color, opacity);
    draw_runs(canvas, &runs, stack, x, baseline, &fill);
}

// ---------------------------------------------------------------------------
// Drawing (content only; the caller applies the layer transform).
// ---------------------------------------------------------------------------

fn draw_shape(canvas: &Canvas, s: &ShapeLayer) {
    let opacity = s.transform.opacity;
    let mut paint = Paint::default();
    paint.set_anti_alias(true);

    if let Some(stroke) = &s.stroke {
        paint.set_style(PaintStyle::Stroke);
        paint.set_stroke_width(s.stroke_width.unwrap_or(1.0));
        paint.set_color(parse_color(stroke, opacity));
    } else {
        paint.set_style(PaintStyle::Fill);
        paint.set_color(parse_color(solid_or(&s.fill, "#000000"), opacity));
    }

    if let Some(dash) = &s.dash {
        if dash.len() >= 2 {
            if let Some(effect) = PathEffect::dash(dash, s.dash_phase.unwrap_or(0.0)) {
                paint.set_path_effect(effect);
            }
        }
    }

    match s.shape.as_str() {
        "circle" => {
            let radius = s
                .radius
                .unwrap_or_else(|| s.width.unwrap_or(0.0).min(s.height.unwrap_or(0.0)) / 2.0);
            canvas.draw_circle((radius, radius), radius, &paint);
        }
        "path" => {
            if let Some(d) = &s.path {
                if let Some(path) = Path::from_svg(d) {
                    canvas.draw_path(&path, &paint);
                }
            }
        }
        _ => {
            canvas.draw_rect(
                Rect::from_xywh(0.0, 0.0, s.width.unwrap_or(0.0), s.height.unwrap_or(0.0)),
                &paint,
            );
        }
    }
}

fn draw_text(canvas: &Canvas, layer: &TextLayer) {
    let size = layer.size.unwrap_or(16.0);
    let stack = font_stack(layer.font.as_deref(), size);
    if stack.is_empty() {
        return;
    }
    let line_height = layer.line_height.unwrap_or(size * 1.2);
    let lines = wrap_text(&stack, &layer.text, layer.max_width);
    let color = solid_or(&layer.color, "#000000");
    let style = layer.style();
    for (i, line) in lines.iter().enumerate() {
        let x = line_x(layer.align.as_deref(), measure_stack(&stack, line));
        draw_styled_text(canvas, line, x, i as f32 * line_height, color, layer.transform.opacity, &stack, &style);
    }
}

fn draw_caption(canvas: &Canvas, layer: &CaptionLayer) {
    let size = layer.size.unwrap_or(32.0);
    let stack = font_stack(layer.font.as_deref(), size);
    if stack.is_empty() {
        return;
    }
    let line_height = layer.line_height.unwrap_or(size * 1.2);
    let padding = layer.padding.unwrap_or(8.0);
    let opacity = layer.transform.opacity;
    let lines = wrap_text(&stack, &layer.text, layer.max_width);
    let block_width = layer
        .max_width
        .unwrap_or_else(|| lines.iter().map(|l| measure_stack(&stack, l)).fold(0.0, f32::max));

    if let Some(background) = &layer.background_color {
        if let Fill::Solid(bg) = background {
            let bg_x = line_x(layer.align.as_deref(), block_width);
            let paint = fill_paint(bg, opacity);
            canvas.draw_rect(
                Rect::from_xywh(
                    bg_x - padding,
                    -line_height - padding,
                    block_width + padding * 2.0,
                    line_height * lines.len() as f32 + padding * 2.0,
                ),
                &paint,
            );
        }
    }

    let color = solid_or(&layer.color, "#ffffff");
    let style = layer.style();
    for (i, line) in lines.iter().enumerate() {
        let x = line_x(layer.align.as_deref(), measure_stack(&stack, line));
        draw_styled_text(canvas, line, x, i as f32 * line_height, color, opacity, &stack, &style);
    }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

fn apply_transform(canvas: &Canvas, t: &Transform) {
    canvas.translate((t.x, t.y));
    canvas.scale((t.scale * t.scale_x, t.scale * t.scale_y));
    canvas.rotate(t.rotate, None);
}

fn render_frame_to_rgba(frame: &Frame) -> napi::Result<Vec<u8>> {
    let width = frame.composition.width;
    let height = frame.composition.height;
    if width <= 0 || height <= 0 {
        return Err(napi::Error::from_reason("composition width/height must be > 0"));
    }

    let mut surface = skia_safe::surfaces::raster_n32_premul((width, height))
        .ok_or_else(|| napi::Error::from_reason("failed to create raster surface"))?;
    let canvas = surface.canvas();
    canvas.clear(Color::TRANSPARENT);

    for layer in &frame.layers {
        let Some(transform) = layer.transform() else {
            continue;
        };
        canvas.save();
        apply_transform(canvas, transform);
        match layer {
            Layer::Shape(s) => draw_shape(canvas, s),
            Layer::Text(t) => draw_text(canvas, t),
            Layer::Caption(c) => draw_caption(canvas, c),
            Layer::Unsupported => {}
        }
        canvas.restore();
    }

    read_rgba(&mut surface, width, height)
}

fn read_rgba(surface: &mut skia_safe::Surface, width: i32, height: i32) -> napi::Result<Vec<u8>> {
    let info = skia_safe::ImageInfo::new(
        (width, height),
        skia_safe::ColorType::RGBA8888,
        skia_safe::AlphaType::Unpremul,
        None,
    );
    let row_bytes = (width as usize) * 4;
    let mut pixels = vec![0u8; row_bytes * height as usize];
    if !surface.read_pixels(&info, pixels.as_mut_slice(), row_bytes, (0, 0)) {
        return Err(napi::Error::from_reason("read_pixels failed"));
    }
    Ok(pixels)
}

// ---------------------------------------------------------------------------
// Color parsing — mirrors the wasm renderer's parseColor: #rgb / #rrggbb use
// `opacity` as the alpha; #rrggbbaa and rgb()/rgba() multiply their own alpha by
// `opacity`. Named CSS colors are not handled yet.
// ---------------------------------------------------------------------------

fn parse_color(color: &str, opacity: f32) -> Color {
    let opacity = opacity.clamp(0.0, 1.0);
    let alpha = (opacity * 255.0).round() as u8;
    let t = color.trim();

    if let Some(hex) = t.strip_prefix('#') {
        match hex.len() {
            3 => {
                if let (Some(r), Some(g), Some(b)) = (nibble(hex, 0), nibble(hex, 1), nibble(hex, 2)) {
                    return Color::from_argb(alpha, r, g, b);
                }
            }
            6 => {
                if let (Some(r), Some(g), Some(b)) = (byte(hex, 0), byte(hex, 2), byte(hex, 4)) {
                    return Color::from_argb(alpha, r, g, b);
                }
            }
            8 => {
                if let (Some(r), Some(g), Some(b), Some(ca)) =
                    (byte(hex, 0), byte(hex, 2), byte(hex, 4), byte(hex, 6))
                {
                    let a = ((ca as f32 / 255.0) * opacity * 255.0).round() as u8;
                    return Color::from_argb(a, r, g, b);
                }
            }
            _ => {}
        }
    }

    if let Some(color) = parse_rgb_func(t, opacity) {
        return color;
    }

    Color::from_argb(alpha, 0, 0, 0)
}

fn parse_rgb_func(t: &str, opacity: f32) -> Option<Color> {
    let lower = t.to_ascii_lowercase();
    let inner = lower
        .strip_prefix("rgba(")
        .or_else(|| lower.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
    if parts.len() < 3 {
        return None;
    }
    let r = parts[0].parse::<f32>().ok()?.clamp(0.0, 255.0) as u8;
    let g = parts[1].parse::<f32>().ok()?.clamp(0.0, 255.0) as u8;
    let b = parts[2].parse::<f32>().ok()?.clamp(0.0, 255.0) as u8;
    let channel_alpha = if parts.len() >= 4 {
        parts[3].parse::<f32>().ok()?.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let a = (channel_alpha * opacity * 255.0).round() as u8;
    Some(Color::from_argb(a, r, g, b))
}

fn nibble(hex: &str, index: usize) -> Option<u8> {
    let c = hex.as_bytes().get(index)?;
    let v = (*c as char).to_digit(16)? as u8;
    Some(v * 16 + v)
}

fn byte(hex: &str, index: usize) -> Option<u8> {
    let slice = hex.get(index..index + 2)?;
    u8::from_str_radix(slice, 16).ok()
}

// ---------------------------------------------------------------------------
// napi exports
// ---------------------------------------------------------------------------

/// Render a full ResolvedFrame (passed as JSON) to an RGBA8888 buffer.
#[napi]
pub fn render_frame(frame_json: String) -> napi::Result<Buffer> {
    let frame: Frame = serde_json::from_str(&frame_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid frame JSON: {e}")))?;
    Ok(Buffer::from(render_frame_to_rgba(&frame)?))
}

/// Smoke entry point retained from Phase 0b.
#[napi]
pub fn render_smoke(width: u32, height: u32, r: u8, g: u8, b: u8, a: u8) -> napi::Result<Buffer> {
    if width == 0 || height == 0 {
        return Err(napi::Error::from_reason("width and height must be > 0"));
    }
    let mut surface = skia_safe::surfaces::raster_n32_premul((width as i32, height as i32))
        .ok_or_else(|| napi::Error::from_reason("failed to create raster surface"))?;
    surface.canvas().clear(Color::from_argb(a, r, g, b));
    read_rgba(&mut surface, width as i32, height as i32).map(Buffer::from)
}
