use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    /// Approximate number of characters of paper text sent per request.
    pub chunk_chars: usize,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Produce margin annotations (needed by Sharpie and Professional modes).
    pub annotate: bool,
    /// Also ask for formal review-style comments (Professional mode).
    pub professional: bool,
    /// Build the secondary companion document.
    pub companion: bool,
    pub tldr: bool,
    pub acronyms: bool,
    /// "light" | "balanced" | "thorough"
    pub density: String,
    /// "undergrad" | "grad" | "expert"
    pub level: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub path: String,
    pub settings: Settings,
    pub options: Options,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: u32,
    pub page: u32,
    pub quote: String,
    pub kind: String,
    pub note: String,
    pub detail: String,
    pub category: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tldr {
    pub one_liner: String,
    pub bullets: Vec<String>,
    pub eli5: String,
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Acronym {
    pub short: String,
    pub long: String,
    /// "paper" when the paper itself defines it, "inferred" when the model guessed.
    pub source: String,
    pub count: u32,
    pub first_page: u32,
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub title: String,
    pub n_pages: u32,
    pub model: String,
    pub annotations: Vec<Annotation>,
    pub tldr: Option<Tldr>,
    pub acronyms: Vec<Acronym>,
    pub companion_md: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperInfo {
    pub title: String,
    pub n_pages: u32,
    pub chars: usize,
    pub has_text: bool,
    /// Zero-based indices of pages with (almost) no embedded text: they need OCR.
    pub ocr_pages: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub stage: String,
    pub done: u32,
    pub total: u32,
    pub message: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryExport {
    pub title: String,
    pub model: String,
    pub tldr: Option<Tldr>,
    pub acronyms: Vec<Acronym>,
    pub annotations: Vec<Annotation>,
}

