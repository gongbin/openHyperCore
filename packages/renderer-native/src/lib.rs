//! Native (Rust + skia-safe) render backend for OpenHyperCore.
//!
//! The whole `ResolvedFrame` (already plain numeric data on the TS side) is
//! handed across the napi boundary once per frame as JSON and drawn natively,
//! returning a single RGBA8888 (unpremultiplied) buffer. This eliminates the
//! per-primitive JS<->native crossings and the per-frame readback copy that the
//! canvaskit-wasm path pays.
//!
//! Phase 1: shapes (rect/circle/path) with transform, solid fill, stroke, dash.
//! Text/image/video/group and gradients/blend/blur/clip land in later phases.

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde::Deserialize;
use skia_safe::{Canvas, Color, Paint, PaintStyle, Path, PathEffect, Rect};

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
    // Gradient objects land in Phase 3; matched but ignored (drawn as nothing)
    // for now so they don't fail deserialization.
    #[allow(dead_code)]
    Other(serde_json::Value),
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

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Layer {
    Shape(ShapeLayer),
    // Every other layer type (text/image/video/group/caption/audio) is skipped
    // until its phase lands.
    #[serde(other)]
    Unsupported,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    composition: CompositionMeta,
    layers: Vec<Layer>,
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

fn draw_shape(canvas: &Canvas, s: &ShapeLayer) {
    canvas.save();
    let t = &s.transform;
    canvas.translate((t.x, t.y));
    canvas.scale((t.scale * t.scale_x, t.scale * t.scale_y));
    canvas.rotate(t.rotate, None);

    let mut paint = Paint::default();
    paint.set_anti_alias(true);

    if let Some(stroke) = &s.stroke {
        // A stroke replaces the fill (mirrors the wasm renderer).
        paint.set_style(PaintStyle::Stroke);
        paint.set_stroke_width(s.stroke_width.unwrap_or(1.0));
        paint.set_color(parse_color(stroke, t.opacity));
    } else {
        paint.set_style(PaintStyle::Fill);
        let fill = match &s.fill {
            Some(Fill::Solid(c)) => c.as_str(),
            _ => "#000000",
        };
        paint.set_color(parse_color(fill, t.opacity));
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

    canvas.restore();
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
        if let Layer::Shape(shape) = layer {
            draw_shape(canvas, shape);
        }
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
// `opacity`. Named CSS colors are not handled yet (Phase 2+).
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
