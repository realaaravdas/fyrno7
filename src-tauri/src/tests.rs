use crate::analysis::*;
use crate::llm::Client;
use crate::textutil::{locate, normalize};
use crate::types::*;
use crate::acronyms;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn fixture() -> String {
    format!("{}/tests/fixtures/sample.pdf", env!("CARGO_MANIFEST_DIR"))
}

/// Minimal OpenAI-compatible server that answers by recognising the prompt.
async fn fake_llm() -> u16 {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = l.accept().await.unwrap();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 8192];
                loop {
                    let n = s.read(&mut tmp).await.unwrap();
                    buf.extend_from_slice(&tmp[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(h) = text.find("\r\n\r\n") {
                        let cl = text[..h]
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if buf.len() >= h + 4 + cl || n == 0 {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let req = String::from_utf8_lossy(&buf).to_string();
                let is_models = req.starts_with("GET /v1/models");
                let content = if req.contains("research_question") {
                    r#"{"overview":"Studies SGD with adaptive schedules.","research_question":"Do adaptive schedules help?","contributions":["AWS scheduler"],"method":"Adaptive warmup.","key_results":["91.3% accuracy"],"strengths":["Clear baseline"],"weaknesses":["English only"],"open_questions":["Other languages?"],"terms_to_know":[{"term":"AWS","meaning":"scheduler"}],"further_reading":["LR schedules"],"next_steps":["Reproduce"]}"#.to_string()
                } else if req.contains("one_liner") {
                    r#"{"one_liner":"Adaptive schedules cut loss by 14%.","bullets":["a","b"],"eli5":"Learning rate tuning helps.","keywords":["sgd"]}"#.to_string()
                } else if req.contains("confidence") {
                    r#"{"acronyms":[{"short":"NLP","long":"Natural Language Processing","confidence":"high"},{"short":"GPUs","long":"","confidence":"low"}]}"#.to_string()
                } else {
                    let mut c = String::from("```json\n{\"digest\":\"Intro and method.\",\"annotations\":[");
                    c.push_str(r#"{"page":1,"quote":"adaptive learning rates reduce the validation loss by 14.2 percent","kind":"star","note":"main result","category":"result","detail":"Key quantitative claim.","severity":"major"},"#);
                    c.push_str(r#"{"page":2,"quote":"we only evaluated on English text","kind":"doubt","note":"narrow","category":"limitation"},"#);
                    c.push_str(r#"{"page":1,"quote":"this sentence does not exist anywhere in the paper","kind":"circle","note":"made up","category":"claim"},"#);
                    c.push_str("]}\n```");
                    c
                };
                let body = if is_models {
                    r#"{"data":[{"id":"gemma-3-12b-it"},{"id":"text-embedding-nomic"}]}"#.to_string()
                } else {
                    serde_json::json!({"choices":[{"message":{"content":content}}]}).to_string()
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = s.write_all(resp.as_bytes()).await;
            });
        }
    });
    port
}

#[test]
fn extracts_text_and_title() {
    let pages = extract_pages(&fixture()).expect("extract");
    assert_eq!(pages.len(), 2);
    assert!(pages[0].contains("Stochastic Gradient Descent"));
    assert!(guess_title(&pages).contains("Attention Improves Learning"));
    assert_eq!(references_start(&pages), pages.len()); // too short to cut anything
}

#[test]
fn locates_quotes_despite_wrapping() {
    let page = "We study how Stochastic Gradient Descent (SGD) behaves when training Large Language\nModels (LLMs) with small batches.";
    let n = normalize(page);
    let q = locate(page, &n, "training large language models (llms)").unwrap();
    assert_eq!(q, "training Large Language Models (LLMs");
    assert!(locate(page, &n, "completely different sentence here").is_none());
}

#[test]
fn mines_acronyms() {
    let pages = vec!["We use Stochastic Gradient Descent (SGD) and Large Language Models (LLMs). SGD is fast. NLP people like NLP. The reinforcement learning from human feedback (RLHF) step.".to_string()];
    let c = acronyms::mine(&pages, 1);
    let get = |s: &str| c.iter().find(|x| x.short == s).unwrap_or_else(|| panic!("missing {s}"));
    assert_eq!(get("SGD").defined.as_deref(), Some("Stochastic Gradient Descent"));
    assert_eq!(get("LLM").defined.as_deref(), Some("Large Language Models"));
    assert_eq!(get("RLHF").defined.as_deref(), Some("reinforcement learning from human feedback"));
    assert!(get("NLP").defined.is_none() && get("NLP").count == 2);
}

#[test]
fn salvages_truncated_json() {
    let t = r#"{"digest":"x","annotations":[{"page":1,"quote":"a b c d e f"},{"page":2,"quote":"cut o"#;
    assert_eq!(crate::llm::salvage_objects(t, "annotations").len(), 1);
}

#[tokio::test]
async fn full_pipeline_against_fake_server() {
    let port = fake_llm().await;
    let s = Settings {
        base_url: format!("http://127.0.0.1:{port}"),
        api_key: String::new(),
        model: "gemma-3-12b-it".into(),
        temperature: 0.2,
        chunk_chars: 9000,
        max_tokens: 1024,
    };
    let models = Client::new(&s).list_models().await.unwrap();
    assert_eq!(models, vec!["gemma-3-12b-it"]);

    let mut pages = extract_pages(&fixture()).unwrap();
    pages[1].push_str("
NLP methods and NLP benchmarks matter.
");
    let req = AnalyzeRequest {
        path: fixture(),
        settings: s,
        options: Options {
            annotate: true,
            professional: true,
            companion: true,
            tldr: true,
            acronyms: true,
            density: "balanced".into(),
            level: "grad".into(),
        },
    };
    let seen = Arc::new(std::sync::Mutex::new(vec![]));
    let seen2 = seen.clone();
    let cb = move |p: Progress| seen2.lock().unwrap().push(p.stage);
    let res = run(&cb, req, pages, Arc::new(AtomicBool::new(false))).await.expect("pipeline");

    assert_eq!(res.annotations.len(), 2, "hallucinated quote must be dropped: {:?}", res.annotations);
    assert_eq!(res.annotations[0].page, 1);
    assert_eq!(res.annotations[0].kind, "star");
    assert_eq!(res.annotations[0].severity, "major");
    assert_eq!(res.annotations[1].page, 2);
    assert_eq!(res.tldr.as_ref().unwrap().one_liner, "Adaptive schedules cut loss by 14%.");
    let sgd = res.acronyms.iter().find(|a| a.short == "SGD").unwrap();
    assert_eq!((sgd.source.as_str(), sgd.long.as_str()), ("paper", "Stochastic Gradient Descent"));
    let nlp = res.acronyms.iter().find(|a| a.short == "NLP").unwrap();
    assert_eq!(nlp.source, "inferred");
    let md = res.companion_md.unwrap();
    assert!(md.contains("## Critical read") && md.contains("## Annotation index") && md.contains("Page-by-page"), "{md}");
    assert!(seen.lock().unwrap().contains(&"done".to_string()));
}

#[test]
fn summary_pdf_roundtrip() {
    let ann = |id: u32, page: u32, q: &str| Annotation {
        id, page, quote: q.into(), kind: "star".into(), note: "main result \u{2014} \u{201C}wow\u{201D} (really)".into(),
        detail: "Key claim, with caf\u{e9} and parentheses (like this) \\ backslash.".into(),
        category: "result".into(), severity: "major".into(),
    };
    let mut anns = vec![];
    for i in 0..40 { anns.push(ann(i + 1, 1 + i / 8, "adaptive learning rates reduce the validation loss")); }
    let data = SummaryExport {
        title: "A Very Long Paper Title About Stochastic Gradient Descent and Friends".into(),
        model: "gemma-3".into(),
        tldr: Some(Tldr { one_liner: "Adaptive schedules cut loss.".into(), bullets: vec!["Point one".into(), "Point two".into()], eli5: "Simple words.".into(), keywords: vec!["sgd".into()] }),
        acronyms: vec![Acronym { short: "SGD".into(), long: "Stochastic Gradient Descent".into(), source: "paper".into(), count: 4, first_page: 1, context: String::new() }],
        annotations: anns,
    };
    let bytes = crate::pdfout::render(&data);
    assert!(bytes.starts_with(b"%PDF-1.4"));
    let path = std::env::temp_dir().join("fyrno7-summary-test.pdf");
    std::fs::write(&path, &bytes).unwrap();
    let pages = extract_pages(path.to_str().unwrap()).expect("our own PDF must parse");
    assert!(pages.len() >= 2, "40 annotations should span several pages, got {}", pages.len());
    let all = pages.join("\n");
    assert!(all.contains("Stochastic Gradient Descent") && all.contains("Adaptive schedules cut loss") && all.contains("PAGE 5"), "{all}");
}

#[test]
fn ocr_reads_a_scanned_page_locally() {
    let png = std::fs::read(format!("{}/tests/fixtures/scan.png", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let t = std::time::Instant::now();
    let page = crate::ocr::recognize(&png).expect("ocr");
    eprintln!("OCR took {:?}:\n{}", t.elapsed(), page.text);
    let low = page.text.to_lowercase();
    assert!(low.contains("networks learn representations") && low.contains("english text"), "got: {}", page.text);
    assert!(page.lines.len() >= 3);
    // positions are normalised fractions, top-to-bottom
    assert!(page.lines.iter().all(|l| l.x >= 0.0 && l.y >= 0.0 && l.x + l.w <= 1.01 && l.y + l.h <= 1.01));
    assert!(page.lines[0].y < page.lines[2].y);
    // quote verification works on OCR output too
    let n = crate::textutil::normalize(&page.text);
    assert!(crate::textutil::locate(&page.text, &n, "learn representations from data").is_some());
}

#[test]
fn image_only_pdf_is_flagged_for_ocr() {
    let pages = extract_pages(&format!("{}/tests/fixtures/scan.pdf", env!("CARGO_MANIFEST_DIR"))).expect("a scan must not crash extraction");
    assert_eq!(pages.len(), 1);
    assert!(pages[0].trim().chars().count() < 40, "scan unexpectedly has text: {:?}", pages[0]);
}

#[test]
fn demo_sample_paper_extracts() {
    let pages = extract_pages(&format!("{}/../ui/demo/sample-paper.pdf", env!("CARGO_MANIFEST_DIR"))).expect("sample paper must parse");
    assert_eq!(pages.len(), 2);
    assert!(pages[0].contains("Adaptive Warmup Scheduler (AWS)") && pages[1].contains("FLOPs"));
}
