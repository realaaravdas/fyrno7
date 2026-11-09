use crate::acronyms;
use crate::llm::{extract_json, salvage_objects, Client};
use crate::prompts::{self, ChunkPrompt};
use crate::textutil::{locate, normalize};
use crate::types::*;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
/// Progress sink; the Tauri layer forwards these to the UI as events.
pub type Emitter = dyn Fn(Progress) + Send + Sync;

const KINDS: &[&str] = &[
    "highlight", "underline", "circle", "question", "star", "doubt", "define", "link",
];
const CATEGORIES: &[&str] = &[
    "claim", "method", "result", "limitation", "definition", "question", "reference", "insight",
];

pub fn extract_pages(path: &str) -> Result<Vec<String>, String> {
    let p = path.to_string();
    let res = std::panic::catch_unwind(move || pdf_extract::extract_text_by_pages(&p));
    match res {
        Ok(Ok(pages)) => Ok(pages.into_iter().map(|s| clean_page(&s)).collect()),
        Ok(Err(e)) => Err(format!("Could not read this PDF: {e}")),
        Err(_) => Err("The PDF text extractor crashed on this file (unusual fonts or encryption).".into()),
    }
}

fn clean_page(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blank = 0;
    for line in s.lines() {
        let l = line.trim_end();
        if l.trim().is_empty() {
            blank += 1;
            if blank <= 1 {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(l);
            out.push('\n');
        }
    }
    out
}

pub fn guess_title(pages: &[String]) -> String {
    let first = pages.iter().find(|p| !p.trim().is_empty());
    let Some(first) = first else { return "Untitled paper".into() };
    let lines: Vec<&str> = first
        .lines()
        .map(|l| l.trim())
        .filter(|l| l.chars().count() > 6)
        .take(3)
        .collect();
    let mut t = lines.first().copied().unwrap_or("Untitled paper").to_string();
    // Titles often wrap onto a second line.
    if t.chars().count() < 55 {
        if let Some(l2) = lines.get(1) {
            if !l2.contains('@') && l2.chars().count() < 70 && !l2.to_lowercase().starts_with("abstract") {
                t = format!("{t} {l2}");
            }
        }
    }
    t.chars().take(140).collect()
}

/// Index of the page where the bibliography starts (pages.len() when none found).
pub fn references_start(pages: &[String]) -> usize {
    let n = pages.len();
    if n < 3 {
        return n;
    }
    for (i, p) in pages.iter().enumerate().skip(n / 3) {
        let hit = p.lines().any(|l| {
            let t = l.trim().trim_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ');
            matches!(t.to_lowercase().as_str(), "references" | "bibliography" | "literature cited")
        });
        if hit {
            return i;
        }
    }
    n
}

fn emit(cb: &Emitter, stage: &str, done: u32, total: u32, message: impl Into<String>) {
    cb(Progress { stage: stage.into(), done, total, message: message.into() });
}

fn check_cancel(c: &AtomicBool) -> Result<(), String> {
    if c.load(Ordering::SeqCst) {
        Err("Cancelled".into())
    } else {
        Ok(())
    }
}

fn s(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").trim().to_string()
}
fn list(v: &Value, k: &str) -> Vec<String> {
    v[k].as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|t| t.trim().to_string()))
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default()
}
fn clip(t: &str, n: usize) -> String {
    let t = t.trim();
    if t.chars().count() <= n {
        t.to_string()
    } else {
        let mut o: String = t.chars().take(n).collect();
        o.push('…');
        o
    }
}

/// Run a prompt, parse with `parse`, retry once on a transport or parse failure.
async fn ask<T>(
    client: &Client,
    prompt: &str,
    cancel: &AtomicBool,
    parse: impl Fn(&str) -> Option<T>,
) -> Result<T, String> {
    let mut last = String::new();
    for _ in 0..2 {
        check_cancel(cancel)?;
        match client.chat(prompt).await {
            Ok(text) => {
                if let Some(v) = parse(&text) {
                    return Ok(v);
                }
                last = "The model did not return usable JSON.".into();
            }
            Err(e) => {
                // Connection problems and context overflows will not fix themselves.
                if e.contains("context window") || e.contains("Could not") || e.contains("failed") {
                    return Err(e);
                }
                last = e;
            }
        }
    }
    Err(last)
}

struct Chunk {
    first: usize,
    last: usize, // inclusive
}

fn make_chunks(pages: &[String], end: usize, budget: usize) -> Vec<Chunk> {
    let mut out = vec![];
    let mut cur: Option<Chunk> = None;
    let mut size = 0usize;
    for i in 0..end {
        if pages[i].trim().is_empty() {
            continue;
        }
        let len = pages[i].len();
        match cur.as_mut() {
            Some(c) if size + len <= budget => {
                c.last = i;
                size += len;
            }
            _ => {
                if let Some(c) = cur.take() {
                    out.push(c);
                }
                cur = Some(Chunk { first: i, last: i });
                size = len;
            }
        }
    }
    if let Some(c) = cur {
        out.push(c);
    }
    out
}

pub async fn run(
    cb: &Emitter,
    req: AnalyzeRequest,
    pages: Vec<String>,
    cancel: Arc<AtomicBool>,
) -> Result<AnalysisResult, String> {
    let opts = &req.options;
    let client = Client::new(&req.settings);
    let title = guess_title(&pages);
    let refs_at = references_start(&pages);
    let mut warnings: Vec<String> = vec![];

    let need_chunks = opts.annotate || opts.companion || opts.tldr;
    let chunks = if need_chunks {
        make_chunks(&pages, refs_at.max(1), req.settings.chunk_chars.max(2000))
    } else {
        vec![]
    };
    let total = chunks.len() as u32
        + opts.tldr as u32
        + opts.acronyms as u32
        + opts.companion as u32;
    let mut done = 0u32;

    // --- pass 1: margin annotations + per-chunk digests ---------------------
    let mut annotations: Vec<Annotation> = vec![];
    let mut digests: Vec<(usize, usize, String)> = vec![];
    let norms: Vec<_> = pages.iter().map(|p| normalize(p)).collect();
    let mut next_id = 1u32;

    for (ci, ch) in chunks.iter().enumerate() {
        check_cancel(&cancel)?;
        emit(
            cb,
            "read",
            done,
            total,
            format!("Reading pages {}–{} ({} of {})", ch.first + 1, ch.last + 1, ci + 1, chunks.len()),
        );
        let mut text = String::new();
        for i in ch.first..=ch.last {
            text.push_str(&format!("=== PAGE {} ===\n{}\n", i + 1, pages[i]));
        }
        let prompt = prompts::chunk(&ChunkPrompt {
            title: &title,
            level: &opts.level,
            density: &opts.density,
            want_annotations: opts.annotate,
            professional: opts.professional,
            pages_text: &text,
        });

        let parsed = ask(&client, &prompt, &cancel, |t| {
            let mut digest = String::new();
            let mut items: Vec<Value> = vec![];
            if let Some(v) = extract_json(t) {
                digest = s(&v, "digest");
                if let Some(a) = v["annotations"].as_array() {
                    items = a.clone();
                }
            }
            if items.is_empty() {
                items = salvage_objects(t, "annotations");
            }
            if digest.is_empty() {
                if let Some(p) = t.find("\"digest\"") {
                    let rest = &t[p + 8..];
                    if let (Some(a), Some(b)) = (rest.find('"'), rest.rfind("\",")) {
                        if b > a {
                            digest = rest[a + 1..b].to_string();
                        }
                    }
                }
            }
            if items.is_empty() && digest.is_empty() {
                None
            } else {
                Some((digest, items))
            }
        })
        .await;

        match parsed {
            Ok((digest, items)) => {
                if !digest.is_empty() {
                    digests.push((ch.first, ch.last, digest));
                }
                for it in items {
                    let quote = s(&it, "quote");
                    if quote.is_empty() {
                        continue;
                    }
                    let want_page = it["page"]
                        .as_u64()
                        .or_else(|| it["page"].as_str().and_then(|x| x.trim().parse().ok()))
                        .unwrap_or(0) as usize;
                    // search the claimed page first, then the rest of the chunk
                    let mut order: Vec<usize> = vec![];
                    if want_page >= 1 && (ch.first + 1..=ch.last + 1).contains(&want_page) {
                        order.push(want_page - 1);
                    }
                    let rest: Vec<usize> = (ch.first..=ch.last).filter(|p| !order.contains(p)).collect();
                    order.extend(rest);
                    let found = order.iter().find_map(|&p| {
                        locate(&pages[p], &norms[p], &quote).map(|q| (p, q))
                    });
                    let Some((p, exact)) = found else { continue };
                    if annotations.iter().any(|a| a.page == p as u32 + 1 && a.quote == exact) {
                        continue;
                    }
                    let kind = s(&it, "kind").to_lowercase();
                    let cat = s(&it, "category").to_lowercase();
                    let sev = s(&it, "severity").to_lowercase();
                    annotations.push(Annotation {
                        id: next_id,
                        page: p as u32 + 1,
                        quote: exact,
                        kind: if KINDS.contains(&kind.as_str()) { kind } else { "highlight".into() },
                        note: clip(&s(&it, "note"), 140),
                        detail: clip(&s(&it, "detail"), 360),
                        category: if CATEGORIES.contains(&cat.as_str()) { cat } else { "insight".into() },
                        severity: if ["info", "minor", "major"].contains(&sev.as_str()) { sev } else { "info".into() },
                    });
                    next_id += 1;
                }
            }
            Err(e) => {
                if e.contains("Cancelled") {
                    return Err(e);
                }
                if e.contains("Could not") || e.contains("context window") {
                    return Err(e);
                }
                warnings.push(format!("Pages {}–{} could not be annotated: {e}", ch.first + 1, ch.last + 1));
            }
        }
        done += 1;
    }
    annotations.sort_by_key(|a| (a.page, a.id));
    for (i, a) in annotations.iter_mut().enumerate() {
        a.id = i as u32 + 1;
    }
    if opts.annotate && annotations.is_empty() && warnings.is_empty() {
        warnings.push("The model returned no annotations that could be matched to the page text.".into());
    }

    // material for global passes: opening of paper + digests
    let budget = req.settings.chunk_chars.max(2000);
    let opening: String = pages
        .iter()
        .take(2)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(budget / 2)
        .collect();
    let mut digest_text = String::new();
    for (a, b, d) in &digests {
        let label = if a == b { format!("Page {}", a + 1) } else { format!("Pages {}–{}", a + 1, b + 1) };
        digest_text.push_str(&format!("- {label}: {d}\n"));
    }
    let digest_text: String = digest_text.chars().take(budget).collect();
    let material = format!("{opening}\n\n--- Section digests ---\n{digest_text}");

    // --- TL;DR -----------------------------------------------------------------
    let mut tldr = None;
    if opts.tldr {
        check_cancel(&cancel)?;
        emit(cb, "tldr", done, total, "Writing the TL;DR");
        let r = ask(&client, &prompts::tldr(&title, &opts.level, &material), &cancel, |t| {
            let v = extract_json(t)?;
            let o = s(&v, "one_liner");
            if o.is_empty() {
                return None;
            }
            Some(Tldr {
                one_liner: o,
                bullets: list(&v, "bullets"),
                eli5: s(&v, "eli5"),
                keywords: list(&v, "keywords"),
            })
        })
        .await;
        match r {
            Ok(t) => tldr = Some(t),
            Err(e) if e.contains("Cancelled") => return Err(e),
            Err(e) => warnings.push(format!("TL;DR failed: {e}")),
        }
        done += 1;
    }

    // --- acronym decoder ------------------------------------------------------
    let mut acr_out: Vec<Acronym> = vec![];
    if opts.acronyms {
        check_cancel(&cancel)?;
        emit(cb, "acronyms", done, total, "Decoding acronyms");
        let cands = acronyms::mine(&pages, pages.len());
        let undefined: Vec<&acronyms::Candidate> =
            cands.iter().filter(|c| c.defined.is_none()).take(28).collect();
        let mut inferred: std::collections::HashMap<String, String> = Default::default();
        if !undefined.is_empty() {
            let items: String = undefined
                .iter()
                .map(|c| format!("- {} — context: \"{}\"", c.short, c.context))
                .collect::<Vec<_>>()
                .join("\n");
            let r = ask(&client, &prompts::acronyms(&title, &items), &cancel, |t| {
                let mut objs = vec![];
                if let Some(v) = extract_json(t) {
                    if let Some(a) = v["acronyms"].as_array() {
                        objs = a.clone();
                    }
                }
                if objs.is_empty() {
                    objs = salvage_objects(t, "acronyms");
                }
                if objs.is_empty() { None } else { Some(objs) }
            })
            .await;
            match r {
                Ok(objs) => {
                    for o in objs {
                        let short = s(&o, "short");
                        let long = s(&o, "long");
                        let conf = s(&o, "confidence").to_lowercase();
                        if !short.is_empty() && !long.is_empty() && conf != "low" {
                            inferred.insert(short, long);
                        }
                    }
                }
                Err(e) if e.contains("Cancelled") => return Err(e),
                Err(e) => warnings.push(format!("Some acronyms could not be expanded: {e}")),
            }
        }
        for c in cands {
            let (long, source) = match &c.defined {
                Some(d) => (d.clone(), "paper"),
                None => match inferred.get(&c.short) {
                    Some(l) => (l.clone(), "inferred"),
                    None => (String::new(), "unknown"),
                },
            };
            // Unknown, rarely used tokens are mostly noise (names, headings).
            if long.is_empty() && c.count < 3 {
                continue;
            }
            acr_out.push(Acronym {
                short: c.short,
                long,
                source: source.into(),
                count: c.count,
                first_page: c.first_page,
                context: c.context,
            });
        }
        done += 1;
    }

    // --- companion document ---------------------------------------------------
    let mut companion_md = None;
    if opts.companion {
        check_cancel(&cancel)?;
        emit(cb, "companion", done, total, "Drafting the companion document");
        let r = ask(&client, &prompts::companion(&title, &opts.level, &material), &cancel, |t| {
            let v = extract_json(t)?;
            if s(&v, "overview").is_empty() && list(&v, "key_results").is_empty() {
                None
            } else {
                Some(v)
            }
        })
        .await;
        let notes = match r {
            Ok(v) => Some(v),
            Err(e) if e.contains("Cancelled") => return Err(e),
            Err(e) => {
                warnings.push(format!("Companion analysis failed, showing page digests only: {e}"));
                None
            }
        };
        companion_md = Some(build_companion(
            &title,
            notes.as_ref(),
            tldr.as_ref(),
            &digests,
            &annotations,
            &acr_out,
        ));
        done += 1;
    }
    emit(cb, "done", done, total, "Finished");

    Ok(AnalysisResult {
        title,
        n_pages: pages.len() as u32,
        model: req.settings.model.clone(),
        annotations,
        tldr,
        acronyms: acr_out,
        companion_md,
        warnings,
    })
}

fn bullets(out: &mut String, items: &[String]) {
    for i in items {
        out.push_str(&format!("- {i}\n"));
    }
    out.push('\n');
}

fn build_companion(
    title: &str,
    n: Option<&Value>,
    tldr: Option<&Tldr>,
    digests: &[(usize, usize, String)],
    anns: &[Annotation],
    acr: &[Acronym],
) -> String {
    let mut o = format!("# Companion notes: {title}\n\n");
    if let Some(t) = tldr {
        o.push_str(&format!("> **TL;DR** {}\n\n", t.one_liner));
    }
    if let Some(v) = n {
        if !s(v, "overview").is_empty() {
            o.push_str(&format!("## Overview\n\n{}\n\n", s(v, "overview")));
        }
        if !s(v, "research_question").is_empty() {
            o.push_str(&format!("**Research question.** {}\n\n", s(v, "research_question")));
        }
        let c = list(v, "contributions");
        if !c.is_empty() {
            o.push_str("## Claimed contributions\n\n");
            bullets(&mut o, &c);
        }
        if !s(v, "method").is_empty() {
            o.push_str(&format!("## Method in plain terms\n\n{}\n\n", s(v, "method")));
        }
        let k = list(v, "key_results");
        if !k.is_empty() {
            o.push_str("## Key results\n\n");
            bullets(&mut o, &k);
        }
    }
    if !digests.is_empty() {
        o.push_str("## Page-by-page digest\n\n");
        for (a, b, d) in digests {
            let label = if a == b { format!("p. {}", a + 1) } else { format!("pp. {}–{}", a + 1, b + 1) };
            o.push_str(&format!("- **{label}**: {d}\n"));
        }
        o.push('\n');
    }
    if let Some(v) = n {
        let st = list(v, "strengths");
        let wk = list(v, "weaknesses");
        if !st.is_empty() || !wk.is_empty() {
            o.push_str("## Critical read\n\n");
            if !st.is_empty() {
                o.push_str("### Strengths\n\n");
                bullets(&mut o, &st);
            }
            if !wk.is_empty() {
                o.push_str("### Weaknesses and risks\n\n");
                bullets(&mut o, &wk);
            }
        }
        let q = list(v, "open_questions");
        if !q.is_empty() {
            o.push_str("## Questions for the authors\n\n");
            bullets(&mut o, &q);
        }
        if let Some(terms) = v["terms_to_know"].as_array() {
            let rows: Vec<String> = terms
                .iter()
                .filter(|t| !s(t, "term").is_empty())
                .map(|t| format!("**{}**: {}", s(t, "term"), s(t, "meaning")))
                .collect();
            if !rows.is_empty() {
                o.push_str("## Terms to know\n\n");
                bullets(&mut o, &rows);
            }
        }
    }
    let defined: Vec<String> = acr
        .iter()
        .filter(|a| !a.long.is_empty())
        .map(|a| {
            format!(
                "**{}**: {}{}",
                a.short,
                a.long,
                if a.source == "inferred" { " *(inferred)*" } else { "" }
            )
        })
        .collect();
    if !defined.is_empty() {
        o.push_str("## Acronyms\n\n");
        bullets(&mut o, &defined);
    }
    if let Some(v) = n {
        let r = list(v, "further_reading");
        if !r.is_empty() {
            o.push_str("## Further reading\n\n");
            bullets(&mut o, &r);
        }
        let ns = list(v, "next_steps");
        if !ns.is_empty() {
            o.push_str("## Next steps\n\n");
            bullets(&mut o, &ns);
        }
    }
    let notable: Vec<&Annotation> = anns
        .iter()
        .filter(|a| !a.note.is_empty() || !a.detail.is_empty())
        .collect();
    if !notable.is_empty() {
        o.push_str("## Annotation index\n\n");
        for a in notable {
            let text = if !a.detail.is_empty() { &a.detail } else { &a.note };
            o.push_str(&format!("- **p. {}** “{}” — {}\n", a.page, a.quote, text));
        }
        o.push('\n');
    }
    o
}
