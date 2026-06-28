//! Native (Rust + skia-safe) render backend for OpenHyperCore.
//!
//! The whole `ResolvedFrame` (already plain numeric data on the TS side) is
//! handed across the napi boundary once per frame as JSON and drawn natively,
//! returning a single RGBA8888 (unpremultiplied) buffer.
//!
//! Phases: shapes (1), text+captions with per-char font fallback (2), and
//! images/clip/gradients/blend/blur/motion-blur/group-precomp/reveal (3) — all
//! mirroring the wasm renderer's algorithm so golden output matches.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde::Deserialize;
use skia_safe::canvas::{SaveLayerRec, SrcRectConstraint};
use skia_safe::font::Edging;
use skia_safe::paint::{Cap, Join};
use skia_safe::{
    gradient_shader, image_filters, BlendMode, BlurStyle, Canvas, ClipOp, Color, Data, Font,
    FontMgr, Image, MaskFilter, Paint, PaintStyle, Path, PathEffect, PathFillType,
    Point, RRect, Rect, Shader, TileMode, Typeface,
};

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

// Fields shared by every layer (BaseLayer + effect props), flattened into each
// layer struct.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Base {
    transform: Transform,
    #[serde(default)]
    clip: Option<Clip>,
    #[serde(default)]
    blend_mode: Option<String>,
    #[serde(default)]
    blur: Option<f32>,
    #[serde(default)]
    motion_blur: Option<MotionBlur>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MotionBlur {
    angle: f32,
    distance: f32,
    #[serde(default)]
    samples: Option<f32>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Clip {
    Rect {
        width: f32,
        height: f32,
        #[serde(default)]
        x: Option<f32>,
        #[serde(default)]
        y: Option<f32>,
        #[serde(default)]
        radius: Option<f32>,
    },
    Circle {
        radius: f32,
        #[serde(default)]
        cx: Option<f32>,
        #[serde(default)]
        cy: Option<f32>,
    },
    Path {
        path: String,
        #[serde(default)]
        fill_rule: Option<String>,
    },
}

#[derive(Deserialize)]
struct GradientStop {
    offset: f32,
    color: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Gradient {
    Linear {
        from: [f32; 2],
        to: [f32; 2],
        stops: Vec<GradientStop>,
    },
    Radial {
        center: [f32; 2],
        radius: f32,
        stops: Vec<GradientStop>,
    },
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Fill {
    Solid(String),
    Gradient(Gradient),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShapeLayer {
    #[serde(flatten)]
    base: Base,
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
}

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
    #[serde(flatten)]
    base: Base,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptionLayer {
    #[serde(flatten)]
    base: Base,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageLayer {
    #[serde(flatten)]
    base: Base,
    src: String,
    #[serde(default)]
    fit: Option<String>,
    #[serde(default)]
    width: Option<f32>,
    #[serde(default)]
    height: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reveal {
    #[serde(rename = "type")]
    kind: String,
    width: f32,
    height: f32,
    #[serde(default)]
    direction: Option<String>,
    progress: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupLayer {
    #[serde(flatten)]
    base: Base,
    layers: Vec<Layer>,
    #[serde(default)]
    reveal: Option<Reveal>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Layer {
    Shape(ShapeLayer),
    Text(TextLayer),
    Caption(CaptionLayer),
    Image(ImageLayer),
    Group(GroupLayer),
    // Audio and anything unknown is skipped.
    #[serde(other)]
    Unsupported,
}

impl Layer {
    fn base(&self) -> Option<&Base> {
        match self {
            Layer::Shape(s) => Some(&s.base),
            Layer::Text(t) => Some(&t.base),
            Layer::Caption(c) => Some(&c.base),
            Layer::Image(i) => Some(&i.base),
            Layer::Group(g) => Some(&g.base),
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
// Paint helpers (solid + gradient fills)
// ---------------------------------------------------------------------------

fn make_gradient_shader(gradient: &Gradient, opacity: f32) -> Option<Shader> {
    let stops = match gradient {
        Gradient::Linear { stops, .. } | Gradient::Radial { stops, .. } => stops,
    };
    if stops.is_empty() {
        return None;
    }
    let mut sorted: Vec<&GradientStop> = stops.iter().collect();
    sorted.sort_by(|a, b| a.offset.partial_cmp(&b.offset).unwrap_or(std::cmp::Ordering::Equal));
    let colors: Vec<Color> = sorted.iter().map(|s| parse_color(&s.color, opacity)).collect();
    let positions: Vec<f32> = sorted.iter().map(|s| s.offset).collect();

    match gradient {
        Gradient::Linear { from, to, .. } => gradient_shader::linear(
            (Point::new(from[0], from[1]), Point::new(to[0], to[1])),
            colors.as_slice(),
            Some(positions.as_slice()),
            TileMode::Clamp,
            None,
            None,
        ),
        Gradient::Radial { center, radius, .. } => gradient_shader::radial(
            Point::new(center[0], center[1]),
            *radius,
            colors.as_slice(),
            Some(positions.as_slice()),
            TileMode::Clamp,
            None,
            None,
        ),
    }
}

fn apply_fill(paint: &mut Paint, fill: &Option<Fill>, fallback: &str, opacity: f32) {
    match fill {
        Some(Fill::Gradient(g)) => {
            if let Some(shader) = make_gradient_shader(g, opacity) {
                paint.set_shader(shader);
            } else {
                paint.set_color(parse_color(fallback, opacity));
            }
        }
        Some(Fill::Solid(c)) => {
            paint.set_color(parse_color(c, opacity));
        }
        None => {
            paint.set_color(parse_color(fallback, opacity));
        }
    }
}

fn fill_paint(fill: &Option<Fill>, fallback: &str, opacity: f32) -> Paint {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(PaintStyle::Fill);
    apply_fill(&mut paint, fill, fallback, opacity);
    paint
}

fn solid_paint(color: &str, opacity: f32) -> Paint {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(PaintStyle::Fill);
    paint.set_color(parse_color(color, opacity));
    paint
}

// ---------------------------------------------------------------------------
// Fonts — per-character fallback stack [primary, emoji, default].
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
    first_existing(&candidates)
        .or_else(|| FontMgr::new().legacy_make_typeface(None, skia_safe::FontStyle::default()))
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
// Text layout (wrap + alignment matching the wasm renderer)
// ---------------------------------------------------------------------------

fn is_cjk(c: char) -> bool {
    let u = c as u32;
    (0x2E80..=0x9FFF).contains(&u) || (0x3000..=0x303F).contains(&u) || (0xFF00..=0xFFEF).contains(&u)
}

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
            break;
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

fn draw_styled_text(
    canvas: &Canvas,
    text: &str,
    x: f32,
    baseline: f32,
    color: &Option<Fill>,
    fallback: &str,
    opacity: f32,
    stack: &[Font],
    style: &TextStyle,
) {
    let runs = split_runs(stack, text);

    if let Some(shadow) = style.shadow_color {
        let mut paint = solid_paint(shadow, opacity);
        if let Some(blur) = MaskFilter::blur(BlurStyle::Normal, style.shadow_blur.unwrap_or(6.0).max(0.1), false) {
            paint.set_mask_filter(blur);
        }
        draw_runs(canvas, &runs, stack, x + style.shadow_dx.unwrap_or(0.0), baseline + style.shadow_dy.unwrap_or(4.0), &paint);
    }

    if let Some(stroke) = style.stroke {
        let mut paint = solid_paint(stroke, opacity);
        paint.set_style(PaintStyle::Stroke);
        paint.set_stroke_width(style.stroke_width.unwrap_or(4.0));
        paint.set_stroke_join(Join::Round);
        paint.set_stroke_cap(Cap::Round);
        draw_runs(canvas, &runs, stack, x, baseline, &paint);
    }

    let fill = fill_paint(color, fallback, opacity);
    draw_runs(canvas, &runs, stack, x, baseline, &fill);
}

fn text_style<'a>(
    stroke: Option<&'a str>,
    stroke_width: Option<f32>,
    shadow_color: Option<&'a str>,
    shadow_blur: Option<f32>,
    shadow_dx: Option<f32>,
    shadow_dy: Option<f32>,
) -> TextStyle<'a> {
    TextStyle { stroke, stroke_width, shadow_color, shadow_blur, shadow_dx, shadow_dy }
}

// ---------------------------------------------------------------------------
// Images (decoded per worker thread, cached by path)
// ---------------------------------------------------------------------------

thread_local! {
    static IMAGE_CACHE: RefCell<HashMap<String, Option<Image>>> = RefCell::new(HashMap::new());
}

fn load_image(src: &str) -> Option<Image> {
    IMAGE_CACHE.with(|cache| {
        if let Some(found) = cache.borrow().get(src) {
            return found.clone();
        }
        let image = std::fs::read(src)
            .ok()
            .and_then(|bytes| Image::from_encoded(Data::new_copy(&bytes)));
        cache.borrow_mut().insert(src.to_string(), image.clone());
        image
    })
}

struct FitRects {
    src: Rect,
    dst: Rect,
}

fn fit_rects(src_w: f32, src_h: f32, dst_w: f32, dst_h: f32, fit: Option<&str>) -> FitRects {
    let full = FitRects {
        src: Rect::from_xywh(0.0, 0.0, src_w, src_h),
        dst: Rect::from_xywh(0.0, 0.0, dst_w, dst_h),
    };
    match fit {
        Some("cover") if src_w > 0.0 && src_h > 0.0 && dst_w > 0.0 && dst_h > 0.0 => {
            let src_aspect = src_w / src_h;
            let dst_aspect = dst_w / dst_h;
            let (mut cw, mut ch) = (src_w, src_h);
            if src_aspect > dst_aspect {
                cw = src_h * dst_aspect;
            } else {
                ch = src_w / dst_aspect;
            }
            FitRects {
                src: Rect::from_xywh((src_w - cw) / 2.0, (src_h - ch) / 2.0, cw, ch),
                dst: Rect::from_xywh(0.0, 0.0, dst_w, dst_h),
            }
        }
        Some("contain") if src_w > 0.0 && src_h > 0.0 && dst_w > 0.0 && dst_h > 0.0 => {
            let src_aspect = src_w / src_h;
            let dst_aspect = dst_w / dst_h;
            let (mut dw, mut dh) = (dst_w, dst_h);
            if src_aspect > dst_aspect {
                dh = dst_w / src_aspect;
            } else {
                dw = dst_h * src_aspect;
            }
            FitRects {
                src: Rect::from_xywh(0.0, 0.0, src_w, src_h),
                dst: Rect::from_xywh((dst_w - dw) / 2.0, (dst_h - dh) / 2.0, dw, dh),
            }
        }
        _ => full,
    }
}

fn draw_image(canvas: &Canvas, layer: &ImageLayer) {
    let Some(image) = load_image(&layer.src) else {
        return;
    };
    let iw = image.width() as f32;
    let ih = image.height() as f32;
    let w = layer.width.unwrap_or(iw);
    let h = layer.height.unwrap_or(ih);
    let rects = fit_rects(iw, ih, w, h, layer.fit.as_deref());
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_alpha_f(layer.base.transform.opacity);
    canvas.draw_image_rect(&image, Some((&rects.src, SrcRectConstraint::Strict)), rects.dst, &paint);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

fn draw_shape(canvas: &Canvas, s: &ShapeLayer) {
    let opacity = s.base.transform.opacity;
    let mut paint = Paint::default();
    paint.set_anti_alias(true);

    if let Some(stroke) = &s.stroke {
        paint.set_style(PaintStyle::Stroke);
        paint.set_stroke_width(s.stroke_width.unwrap_or(1.0));
        paint.set_color(parse_color(stroke, opacity));
    } else {
        paint.set_style(PaintStyle::Fill);
        apply_fill(&mut paint, &s.fill, "#000000", opacity);
    }

    if let Some(dash) = &s.dash {
        if dash.len() >= 2 {
            if let Some(effect) = PathEffect::dash(dash, s.dash_phase.unwrap_or(0.0)) {
                paint.set_path_effect(effect);
            }
        }
    }

    // ShapeLayer.blur is a mask-filter glow (the layer-level image blur skips
    // shapes), matching the wasm renderer.
    if let Some(blur) = s.base.blur {
        if blur > 0.0 {
            if let Some(filter) = MaskFilter::blur(BlurStyle::Normal, blur, false) {
                paint.set_mask_filter(filter);
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
    let style = text_style(
        layer.stroke.as_deref(),
        layer.stroke_width,
        layer.shadow_color.as_deref(),
        layer.shadow_blur,
        layer.shadow_dx,
        layer.shadow_dy,
    );
    for (i, line) in lines.iter().enumerate() {
        let x = line_x(layer.align.as_deref(), measure_stack(&stack, line));
        draw_styled_text(canvas, line, x, i as f32 * line_height, &layer.color, "#000000", layer.base.transform.opacity, &stack, &style);
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
    let opacity = layer.base.transform.opacity;
    let lines = wrap_text(&stack, &layer.text, layer.max_width);
    let block_width = layer
        .max_width
        .unwrap_or_else(|| lines.iter().map(|l| measure_stack(&stack, l)).fold(0.0, f32::max));

    if layer.background_color.is_some() {
        let bg_x = line_x(layer.align.as_deref(), block_width);
        let paint = fill_paint(&layer.background_color, "#000000", opacity);
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

    let style = text_style(
        layer.stroke.as_deref(),
        layer.stroke_width,
        layer.shadow_color.as_deref(),
        layer.shadow_blur,
        layer.shadow_dx,
        layer.shadow_dy,
    );
    for (i, line) in lines.iter().enumerate() {
        let x = line_x(layer.align.as_deref(), measure_stack(&stack, line));
        draw_styled_text(canvas, line, x, i as f32 * line_height, &layer.color, "#ffffff", opacity, &stack, &style);
    }
}

// ---------------------------------------------------------------------------
// Clip + reveal mask
// ---------------------------------------------------------------------------

fn apply_layer_clip(canvas: &Canvas, clip: &Clip) {
    match clip {
        Clip::Circle { radius, cx, cy } => {
            let cx = cx.unwrap_or(*radius);
            let cy = cy.unwrap_or(*radius);
            let rrect = RRect::new_oval(Rect::from_xywh(cx - radius, cy - radius, radius * 2.0, radius * 2.0));
            canvas.clip_rrect(rrect, ClipOp::Intersect, true);
        }
        Clip::Rect { width, height, x, y, radius } => {
            let x = x.unwrap_or(0.0);
            let y = y.unwrap_or(0.0);
            let rect = Rect::from_xywh(x, y, *width, *height);
            match radius {
                Some(r) if *r > 0.0 => {
                    let rrect = RRect::new_rect_xy(rect, *r, *r);
                    canvas.clip_rrect(rrect, ClipOp::Intersect, true);
                }
                _ => {
                    canvas.clip_rect(rect, ClipOp::Intersect, true);
                }
            }
        }
        Clip::Path { path, fill_rule } => {
            if let Some(mut p) = Path::from_svg(path) {
                if fill_rule.as_deref() == Some("evenodd") {
                    p.set_fill_type(PathFillType::EvenOdd);
                }
                canvas.clip_path(&p, ClipOp::Intersect, true);
            }
        }
    }
}

fn apply_reveal_clip(canvas: &Canvas, reveal: &Reveal) {
    let progress = reveal.progress.clamp(0.0, 1.0);
    let (w, h) = (reveal.width, reveal.height);

    if reveal.kind == "clock" {
        let cx = w / 2.0;
        let cy = h / 2.0;
        let radius = (w * w + h * h).sqrt() / 2.0;
        let mut path = Path::new();
        path.move_to((cx, cy));
        path.line_to((cx, cy - radius));
        path.arc_to(Rect::from_xywh(cx - radius, cy - radius, radius * 2.0, radius * 2.0), -90.0, progress * 360.0, false);
        path.close();
        canvas.clip_path(&path, ClipOp::Intersect, true);
        return;
    }

    let rect = match reveal.direction.as_deref().unwrap_or("from-left") {
        "from-right" => Rect::from_xywh(w * (1.0 - progress), 0.0, w * progress, h),
        "from-top" => Rect::from_xywh(0.0, 0.0, w, h * progress),
        "from-bottom" => Rect::from_xywh(0.0, h * (1.0 - progress), w, h * progress),
        _ => Rect::from_xywh(0.0, 0.0, w * progress, h),
    };
    canvas.clip_rect(rect, ClipOp::Intersect, true);
}

// ---------------------------------------------------------------------------
// Layer tree walk (mirrors wasm drawLayer / drawLayerSample / motion blur)
// ---------------------------------------------------------------------------

fn parse_blend(name: &str) -> Option<BlendMode> {
    Some(match name {
        "multiply" => BlendMode::Multiply,
        "screen" => BlendMode::Screen,
        "overlay" => BlendMode::Overlay,
        "darken" => BlendMode::Darken,
        "lighten" => BlendMode::Lighten,
        "add" => BlendMode::Plus,
        "color-dodge" => BlendMode::ColorDodge,
        "color-burn" => BlendMode::ColorBurn,
        "soft-light" => BlendMode::SoftLight,
        "hard-light" => BlendMode::HardLight,
        "difference" => BlendMode::Difference,
        "exclusion" => BlendMode::Exclusion,
        "hue" => BlendMode::Hue,
        "saturation" => BlendMode::Saturation,
        "color" => BlendMode::Color,
        "luminosity" => BlendMode::Luminosity,
        _ => return None,
    })
}

fn apply_transform(canvas: &Canvas, t: &Transform) {
    canvas.translate((t.x, t.y));
    canvas.scale((t.scale * t.scale_x, t.scale * t.scale_y));
    canvas.rotate(t.rotate, None);
}

fn draw_content(canvas: &Canvas, layer: &Layer) {
    match layer {
        Layer::Shape(s) => draw_shape(canvas, s),
        Layer::Text(t) => draw_text(canvas, t),
        Layer::Caption(c) => draw_caption(canvas, c),
        Layer::Image(i) => draw_image(canvas, i),
        Layer::Group(g) => draw_group(canvas, g),
        Layer::Unsupported => {}
    }
}

fn draw_group(canvas: &Canvas, group: &GroupLayer) {
    if let Some(reveal) = &group.reveal {
        if reveal.progress <= 0.0 {
            return;
        }
    }
    let opacity = group.base.transform.opacity;
    if opacity <= 0.0 {
        return;
    }
    if let Some(reveal) = &group.reveal {
        if reveal.progress < 1.0 {
            apply_reveal_clip(canvas, reveal);
        }
    }

    let layered = opacity < 1.0;
    if layered {
        let mut paint = Paint::default();
        paint.set_alpha_f(opacity);
        canvas.save_layer(&SaveLayerRec::default().paint(&paint));
    }
    for child in &group.layers {
        draw_layer(canvas, child);
    }
    if layered {
        canvas.restore();
    }
}

fn draw_layer_sample(canvas: &Canvas, layer: &Layer) {
    let Some(base) = layer.base() else {
        return;
    };
    canvas.save();
    apply_transform(canvas, &base.transform);

    let is_shape = matches!(layer, Layer::Shape(_));
    let blend = base.blend_mode.as_deref().and_then(parse_blend);
    let wants_blur = base.blur.map_or(false, |b| b > 0.0) && !is_shape;
    let mut wrapped = false;
    if blend.is_some() || wants_blur {
        let mut paint = Paint::default();
        if let Some(bm) = blend {
            paint.set_blend_mode(bm);
        }
        if wants_blur {
            let sigma = base.blur.unwrap();
            if let Some(filter) = image_filters::blur((sigma, sigma), TileMode::Decal, None, None) {
                paint.set_image_filter(filter);
            }
        }
        canvas.save_layer(&SaveLayerRec::default().paint(&paint));
        wrapped = true;
    }

    if let Some(clip) = &base.clip {
        apply_layer_clip(canvas, clip);
    }
    draw_content(canvas, layer);

    if wrapped {
        canvas.restore();
    }
    canvas.restore();
}

fn draw_motion_blurred(canvas: &Canvas, layer: &Layer, mb: &MotionBlur) {
    let samples = (mb.samples.unwrap_or(8.0).round() as i32).clamp(2, 64);
    let rad = mb.angle.to_radians();
    let dx = rad.cos() * mb.distance;
    let dy = rad.sin() * mb.distance;
    let alpha = 1.0 / samples as f32;
    for i in 0..samples {
        let offset = i as f32 / (samples - 1) as f32 - 0.5;
        canvas.save();
        canvas.translate((dx * offset, dy * offset));
        let mut paint = Paint::default();
        paint.set_alpha_f(alpha);
        canvas.save_layer(&SaveLayerRec::default().paint(&paint));
        draw_layer_sample(canvas, layer);
        canvas.restore();
        canvas.restore();
    }
}

fn draw_layer(canvas: &Canvas, layer: &Layer) {
    if let Some(base) = layer.base() {
        if let Some(mb) = &base.motion_blur {
            if mb.distance > 0.0 && mb.samples.unwrap_or(8.0) > 1.0 {
                draw_motion_blurred(canvas, layer, mb);
                return;
            }
        }
    } else {
        return;
    }
    draw_layer_sample(canvas, layer);
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

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
        draw_layer(canvas, layer);
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
// Color parsing — mirrors the wasm renderer's parseColor.
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
