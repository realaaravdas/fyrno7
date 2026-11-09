use crate::types::Settings;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::time::Duration;

static THINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<think>.*?</think>").unwrap());
static FENCE: Lazy<Regex> = Lazy::new(|| Regex::new(r"```(?:json|JSON)?").unwrap());
static TRAILING_COMMA: Lazy<Regex> = Lazy::new(|| Regex::new(r",\s*([}\]])").unwrap());

pub fn normalize_base(url: &str) -> String {
    let mut u = url.trim().trim_end_matches('/').to_string();
    if u.is_empty() {
        u = "http://localhost:1234".into();
    }
    if !u.starts_with("http://") && !u.starts_with("https://") {
        u = format!("http://{u}");
    }
    if !u.ends_with("/v1") {
        u.push_str("/v1");
    }
    u
}

pub struct Client {
    http: reqwest::Client,
    base: String,
    key: String,
    model: String,
    temperature: f32,
    max_tokens: u32,
}

impl Client {
    pub fn new(s: &Settings) -> Self {
        Client {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(900))
                .connect_timeout(Duration::from_secs(8))
                .build()
                .expect("http client"),
            base: normalize_base(&s.base_url),
            key: s.api_key.clone(),
            model: s.model.clone(),
            temperature: s.temperature,
            max_tokens: s.max_tokens,
        }
    }

    fn auth(&self, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.key.trim().is_empty() {
            rb
        } else {
            rb.bearer_auth(self.key.trim())
        }
    }

    pub async fn list_models(&self) -> Result<Vec<String>, String> {
        let resp = self
            .auth(self.http.get(format!("{}/models", self.base)))
            .send()
            .await
            .map_err(|e| {
                format!(
                    "Could not reach {} ({}). Is the local server running?",
                    self.base, e
                )
            })?;
        if !resp.status().is_success() {
            return Err(format!("Server answered HTTP {}", resp.status()));
        }
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        let mut out: Vec<String> = v["data"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|m| m["id"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        // Hide embedding models; they cannot chat.
        out.retain(|m| !m.to_lowercase().contains("embed"));
        Ok(out)
    }

    /// Single-turn completion. The whole prompt goes in one user message because
    /// several Gemma chat templates reject a separate `system` role.
    pub async fn chat(&self, prompt: &str) -> Result<String, String> {
        let mut body = json!({
            "messages": [{ "role": "user", "content": prompt }],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": false
        });
        if !self.model.trim().is_empty() {
            body["model"] = json!(self.model);
        }
        let resp = self
            .auth(self.http.post(format!("{}/chat/completions", self.base)))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request to local model failed: {e}"))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            let low = text.to_lowercase();
            if low.contains("context") || low.contains("too many tokens") || low.contains("n_ctx") {
                return Err("The model's context window is too small for this chunk. Lower \"Chunk size\" in Settings or raise the context length when loading the model.".into());
            }
            return Err(format!(
                "Model server returned HTTP {status}: {}",
                text.chars().take(300).collect::<String>()
            ));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| format!("Bad response: {e}"))?;
        let content = v["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("Model returned no content")?;
        Ok(THINK.replace_all(content, "").trim().to_string())
    }
}

/// Parse the first JSON object out of a chatty model reply.
pub fn extract_json(text: &str) -> Option<Value> {
    let t = FENCE.replace_all(text, "");
    let start = t.find('{')?;
    let end = t.rfind('}')?;
    if end <= start {
        return None;
    }
    let slice = &t[start..=end];
    if let Ok(v) = serde_json::from_str::<Value>(slice) {
        return Some(v);
    }
    let fixed = TRAILING_COMMA.replace_all(slice, "$1");
    serde_json::from_str::<Value>(&fixed).ok()
}

/// Pull every complete `{...}` object out of the array stored under `key`,
/// even if the reply was cut off mid-way.
pub fn salvage_objects(text: &str, key: &str) -> Vec<Value> {
    let needle = format!("\"{key}\"");
    let Some(kpos) = text.find(&needle) else {
        return vec![];
    };
    let rest = &text[kpos + needle.len()..];
    let Some(bpos) = rest.find('[') else {
        return vec![];
    };
    let body = &rest[bpos + 1..];
    let mut out = vec![];
    let (mut depth, mut in_str, mut esc, mut start) = (0i32, false, false, None::<usize>);
    for (i, c) in body.char_indices() {
        if in_str {
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => {
                if depth == 0 {
                    start = Some(i);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(s) = start.take() {
                        let frag = TRAILING_COMMA.replace_all(&body[s..=i], "$1");
                        if let Ok(v) = serde_json::from_str::<Value>(&frag) {
                            out.push(v);
                        }
                    }
                }
                if depth < 0 {
                    break;
                }
            }
            ']' if depth == 0 => break,
            _ => {}
        }
    }
    out
}
