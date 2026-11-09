//! Prompt templates. Placeholders look like {{NAME}} so JSON braces need no escaping.

fn level_hint(level: &str) -> &'static str {
    match level {
        "undergrad" => "The reader is an undergraduate with little background: flag jargon, define terms, point out what is non-obvious.",
        "expert" => "The reader is a domain expert: skip basics, be terse and critical, focus on rigor, novelty and weaknesses.",
        _ => "The reader is a graduate student: assume general background but not this subfield's specifics.",
    }
}

pub fn per_page(density: &str) -> &'static str {
    match density {
        "light" => "2 to 3",
        "thorough" => "7 to 9",
        _ => "4 to 6",
    }
}

pub struct ChunkPrompt<'a> {
    pub title: &'a str,
    pub level: &'a str,
    pub density: &'a str,
    pub want_annotations: bool,
    pub professional: bool,
    pub pages_text: &'a str,
}

pub fn chunk(p: &ChunkPrompt) -> String {
    if !p.want_annotations {
        return "You are reading part of an academic paper.\nPaper: \"{{TITLE}}\"\n\nReturn ONLY one JSON object, no prose and no code fences:\n{\"digest\": \"2-3 plain sentences saying what these pages cover and their key points\"}\n\n{{PAGES}}"
            .replace("{{TITLE}}", p.title)
            .replace("{{PAGES}}", p.pages_text);
    }
    let pro_fields = if p.professional {
        ", \"detail\": \"...\", \"severity\": \"...\""
    } else {
        ""
    };
    let pro_rules = if p.professional {
        "- detail: a professional review comment, 1-2 complete sentences, specific and actionable (what is claimed, why it matters or what is missing).\n- severity: info | minor | major (major = deserves real attention from author or reader).\n"
    } else {
        ""
    };
    let t = r#"You are a sharp, well-read human reader marking up a printed copy of an academic paper with a pen. Annotate the pages below the way a careful person actually would: underline key claims, circle jargon and important numbers, put a question mark where the reasoning is unclear, star the main takeaways, and doubt claims that look shaky or unsupported.

Paper: "{{TITLE}}"
{{LEVEL}}

Return ONLY one JSON object (no prose, no code fences) shaped like:
{
  "digest": "2-3 plain sentences: what these pages say",
  "annotations": [
    { "page": 1, "quote": "...", "kind": "...", "note": "...", "category": "..."{{PRO_FIELDS}} }
  ]
}

Field rules:
- page: the number from the "=== PAGE n ===" header the quote appears under.
- quote: 3 to 14 consecutive words copied EXACTLY from the page text (same words, same order, no ellipsis, no paraphrase). Short quotes are better; they must be findable by exact search.
- kind: one of highlight | underline | circle | question | star | doubt | define | link
    highlight = useful fact, underline = key claim, circle = term/number/name worth remembering,
    question = confusing or needs follow-up, star = main takeaway, doubt = weak/unsupported/overclaimed,
    define = a term is defined here, link = connects to another section or to other work.
- note: what you would scribble in the margin: at most 12 words, casual, first person is fine ("wait, why?", "key result", "same trick as sec 3"). May be "" for plain highlights.
- category: one of claim | method | result | limitation | definition | question | reference | insight
{{PRO_RULES}}
Aim for about {{PER_PAGE}} annotations per page, spread across the pages and mixing several kinds. Quality over quantity. Do not annotate the reference list, running headers, or page numbers.

{{PAGES}}"#;
    t.replace("{{TITLE}}", p.title)
        .replace("{{LEVEL}}", level_hint(p.level))
        .replace("{{PRO_FIELDS}}", pro_fields)
        .replace("{{PRO_RULES}}", pro_rules)
        .replace("{{PER_PAGE}}", per_page(p.density))
        .replace("{{PAGES}}", p.pages_text)
}

pub fn tldr(title: &str, level: &str, material: &str) -> String {
    let t = r#"Summarise this academic paper for a busy reader.
Paper: "{{TITLE}}"
{{LEVEL}}

Return ONLY one JSON object (no prose, no code fences):
{
  "one_liner": "a single sentence of at most 30 words stating the paper's contribution and result",
  "bullets": ["4 to 6 short bullets: problem, approach, key results with numbers if given, limitations, why it matters"],
  "eli5": "2-3 sentences in plain language a curious teenager would understand",
  "keywords": ["5 to 8 key topics"]
}

Material (opening text of the paper followed by section digests):
{{MATERIAL}}"#;
    t.replace("{{TITLE}}", title)
        .replace("{{LEVEL}}", level_hint(level))
        .replace("{{MATERIAL}}", material)
}

pub fn companion(title: &str, level: &str, material: &str) -> String {
    let t = r#"You are writing a reader's companion notes for an academic paper: the kind of separate notes document a diligent researcher keeps beside the paper.
Paper: "{{TITLE}}"
{{LEVEL}}

Return ONLY one JSON object (no prose, no code fences):
{
  "overview": "one paragraph: what the paper is about and why it exists",
  "research_question": "the question or problem addressed, one sentence",
  "contributions": ["claimed contributions"],
  "method": "one paragraph describing the approach in plain terms",
  "key_results": ["main findings, with numbers if given"],
  "strengths": ["what is convincing or well done"],
  "weaknesses": ["gaps, threats to validity, missing baselines, overclaims"],
  "open_questions": ["questions a careful reader would ask the authors"],
  "terms_to_know": [{"term": "...", "meaning": "..."}],
  "further_reading": ["topics or kinds of papers to read next"],
  "next_steps": ["practical ways to use, reproduce or extend this work"]
}
Be specific to this paper; do not invent results that are not in the material.

Material (opening text of the paper followed by section digests):
{{MATERIAL}}"#;
    t.replace("{{TITLE}}", title)
        .replace("{{LEVEL}}", level_hint(level))
        .replace("{{MATERIAL}}", material)
}

pub fn acronyms(title: &str, items: &str) -> String {
    let t = r#"These abbreviations appear in the academic paper "{{TITLE}}" but the paper does not define them. Using the context snippet, give the most likely full expansion in the paper's field.

Return ONLY one JSON object (no prose, no code fences):
{ "acronyms": [ { "short": "ABC", "long": "full expansion, or \"\" if you are not sure", "confidence": "high | medium | low" } ] }
Never invent an expansion; prefer "" when unsure.

{{ITEMS}}"#;
    t.replace("{{TITLE}}", title).replace("{{ITEMS}}", items)
}
