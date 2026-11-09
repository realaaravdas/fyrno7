//! Deterministic acronym mining. Definitions that the paper itself gives
//! ("Stochastic Gradient Descent (SGD)") are extracted with regexes, so only
//! genuinely undefined abbreviations need the language model.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

pub struct Candidate {
    pub short: String,
    pub count: u32,
    pub first_page: u32,
    pub context: String,
    /// Expansion found in the paper text, if any.
    pub defined: Option<String>,
}

static FORWARD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"((?:[A-Za-z][A-Za-z\-]*\s+){1,9}[A-Za-z][A-Za-z\-]*)\s*\(\s*([A-Z][A-Za-z0-9\-]{1,9})s?\s*\)")
        .unwrap()
});
static REVERSE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b([A-Z][A-Z0-9]{1,8})s?\s*\(\s*((?:[A-Za-z][A-Za-z\-]*\s+){0,6}[A-Za-z][A-Za-z\-]*)\s*\)")
        .unwrap()
});
static TOKEN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b([A-Z][A-Z0-9]{1,7})s?\b").unwrap());
static ROMAN: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[IVXLCDM]+$").unwrap());

const STOP_TOKENS: &[&str] = &[
    "ABSTRACT", "FIGURE", "TABLE", "APPENDIX", "SECTION", "AND", "THE", "FOR", "WITH", "FROM",
    "NOT", "BUT", "ARE", "NEW", "ALL", "ET", "AL", "PAGE", "EQ", "FIG", "REFERENCES", "OF", "IN",
    "ON", "TO", "AN", "AS", "AT", "BY", "IF", "IS", "IT", "OR", "NO", "ID", "OK", "PP", "VOL",
    "ARXIV", "ACM", "IEEE",
];
const SMALL_WORDS: &[&str] = &[
    "of", "and", "the", "for", "from", "in", "on", "to", "a", "an", "with", "by", "via", "per", "at", "or",
];

fn initials_match(words: &[&str], abbr: &str) -> bool {
    let letters: Vec<char> = abbr
        .chars()
        .filter(|c| c.is_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if letters.len() < 2 {
        return false;
    }
    let mut j = 0;
    for (wi, w) in words.iter().enumerate() {
        // hyphenated words may supply several letters: "Long-Short" -> L, S
        let parts: Vec<&str> = w.split('-').filter(|p| !p.is_empty()).collect();
        let mut matched_any = false;
        for p in &parts {
            let ini = p.chars().next().map(|c| c.to_ascii_lowercase());
            if j < letters.len() && ini == Some(letters[j]) {
                j += 1;
                matched_any = true;
            }
        }
        if !matched_any {
            if wi == 0 || !SMALL_WORDS.contains(&w.to_lowercase().as_str()) {
                return false;
            }
        }
    }
    j == letters.len()
}

/// Try to match the trailing words of `before` against `abbr`.
fn expansion_from_tail(before: &str, abbr: &str) -> Option<String> {
    let words: Vec<&str> = before.split_whitespace().collect();
    let n = abbr.chars().filter(|c| c.is_alphabetic()).count();
    for k in (n.saturating_sub(1).max(2)..=(n + 3).min(words.len())).rev() {
        let tail = &words[words.len() - k..];
        if initials_match(tail, abbr) {
            return Some(tail.join(" "));
        }
    }
    None
}

fn snippet(text: &str, byte_pos: usize, len: usize) -> String {
    let start = text[..byte_pos]
        .char_indices()
        .rev()
        .nth(90)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let end_target = (byte_pos + len + 90).min(text.len());
    let end = (end_target..=text.len())
        .find(|i| text.is_char_boundary(*i))
        .unwrap_or(text.len());
    text[start..end].split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn mine(pages: &[String], last_page_exclusive: usize) -> Vec<Candidate> {
    let mut map: HashMap<String, Candidate> = HashMap::new();
    let upto = last_page_exclusive.min(pages.len());

    for (pi, page) in pages.iter().take(upto).enumerate() {
        // join hard line breaks so definitions that wrap across lines still match
        let flat = page.replace("-\n", "").replace('\n', " ");

        for cap in FORWARD.captures_iter(&flat) {
            let mut abbr = cap[2].to_string();
            // "Large Language Models (LLMs)": drop the plural s
            if abbr.len() > 2 && abbr.ends_with('s') && abbr[..abbr.len() - 1].ends_with(|c: char| c.is_uppercase()) {
                abbr.pop();
            }
            if let Some(exp) = expansion_from_tail(&cap[1], &abbr) {
                let m = cap.get(2).unwrap();
                let e = map.entry(abbr.clone()).or_insert_with(|| Candidate {
                    short: abbr.clone(),
                    count: 0,
                    first_page: pi as u32 + 1,
                    context: snippet(&flat, m.start(), m.len()),
                    defined: None,
                });
                if e.defined.is_none() {
                    e.defined = Some(exp);
                    e.first_page = e.first_page.min(pi as u32 + 1);
                }
            }
        }
        for cap in REVERSE.captures_iter(&flat) {
            let abbr = cap[1].to_string();
            let words: Vec<&str> = cap[2].split_whitespace().collect();
            if initials_match(&words, &abbr) {
                let m = cap.get(1).unwrap();
                let e = map.entry(abbr.clone()).or_insert_with(|| Candidate {
                    short: abbr.clone(),
                    count: 0,
                    first_page: pi as u32 + 1,
                    context: snippet(&flat, m.start(), m.len()),
                    defined: None,
                });
                if e.defined.is_none() {
                    e.defined = Some(words.join(" "));
                }
            }
        }
        for cap in TOKEN.captures_iter(&flat) {
            let t = cap[1].to_string();
            if STOP_TOKENS.contains(&t.as_str()) || ROMAN.is_match(&t) {
                continue;
            }
            let m = cap.get(1).unwrap();
            let e = map.entry(t.clone()).or_insert_with(|| Candidate {
                short: t.clone(),
                count: 0,
                first_page: pi as u32 + 1,
                context: snippet(&flat, m.start(), m.len()),
                defined: None,
            });
            e.count += 1;
        }
    }

    let mut v: Vec<Candidate> = map
        .into_values()
        .filter(|c| c.defined.is_some() || c.count >= 2)
        .collect();
    // defined first, then by frequency
    v.sort_by(|a, b| {
        b.defined
            .is_some()
            .cmp(&a.defined.is_some())
            .then(b.count.cmp(&a.count))
            .then(a.short.cmp(&b.short))
    });
    v.truncate(60);
    v
}
