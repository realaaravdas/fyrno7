//! Fully local OCR for scanned papers, using the pure-Rust `ocrs` engine.
//! Both neural-network models are compiled into the executable, so OCR works
//! offline and nothing is ever downloaded or uploaded.

use ocrs::{ImageSource, OcrEngine, OcrEngineParams};
use once_cell::sync::Lazy;
use rten::Model;
use rten_imageproc::BoundingRect;
use serde::Serialize;
use std::sync::Mutex;

static DETECTION: &[u8] = include_bytes!("../models/text-detection.onnx");
static RECOGNITION: &[u8] = include_bytes!("../models/text-recognition.onnx");

static ENGINE: Lazy<Mutex<Result<OcrEngine, String>>> = Lazy::new(|| {
    Mutex::new((|| {
        let detection_model = Model::load(DETECTION.to_vec()).map_err(|e| format!("OCR detection model: {e}"))?;
        let recognition_model = Model::load(RECOGNITION.to_vec()).map_err(|e| format!("OCR recognition model: {e}"))?;
        OcrEngine::new(OcrEngineParams {
            detection_model: Some(detection_model),
            recognition_model: Some(recognition_model),
            ..Default::default()
        })
        .map_err(|e| format!("OCR engine: {e}"))
    })())
});

/// One recognised line of text. Coordinates are fractions (0..1) of the page image,
/// origin top-left, so they can be mapped onto the page at any zoom level.
#[derive(Debug, Clone, Serialize)]
pub struct OcrLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct OcrPage {
    pub text: String,
    pub lines: Vec<OcrLine>,
}

/// Recognise the text in an encoded image (PNG/JPEG bytes).
pub fn recognize(bytes: &[u8]) -> Result<OcrPage, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Could not decode page image: {e}"))?
        .into_rgb8();
    let (iw, ih) = img.dimensions();
    let guard = ENGINE.lock().map_err(|_| "OCR engine lock poisoned".to_string())?;
    let engine = guard.as_ref().map_err(|e| e.clone())?;

    let source = ImageSource::from_bytes(img.as_raw(), (iw, ih)).map_err(|e| e.to_string())?;
    let input = engine.prepare_input(source).map_err(|e| e.to_string())?;
    let words = engine.detect_words(&input).map_err(|e| e.to_string())?;
    let line_rects = engine.find_text_lines(&input, &words);
    let texts = engine.recognize_text(&input, &line_rects).map_err(|e| e.to_string())?;

    let (fw, fh) = (iw as f32, ih as f32);
    let mut lines = vec![];
    for (rects, text) in line_rects.iter().zip(texts.iter()) {
        let Some(text) = text else { continue };
        let t = text.to_string();
        let t = t.trim();
        if t.chars().count() < 2 || rects.is_empty() {
            continue;
        }
        let (mut l, mut tp, mut r, mut b) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for rect in rects {
            let bb = rect.bounding_rect();
            l = l.min(bb.left());
            tp = tp.min(bb.top());
            r = r.max(bb.right());
            b = b.max(bb.bottom());
        }
        lines.push(OcrLine {
            text: t.to_string(),
            x: (l / fw).clamp(0.0, 1.0),
            y: (tp / fh).clamp(0.0, 1.0),
            w: ((r - l) / fw).clamp(0.0, 1.0),
            h: ((b - tp) / fh).clamp(0.0, 1.0),
        });
    }
    let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    Ok(OcrPage { text, lines })
}
