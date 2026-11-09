//! Dependency-free PDF writer for the "summary" export: TL;DR, acronyms and
//! annotations laid out on A4 pages with the standard Helvetica fonts.

use crate::types::*;

const W: f32 = 595.0;
const H: f32 = 842.0;
const M: f32 = 54.0;

/// Helvetica advance widths for ASCII 32..=126 (units of 1/1000 em).
const HELV: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const GRAY: (f32, f32, f32) = (0.42, 0.45, 0.52);
const INK: (f32, f32, f32) = (0.10, 0.12, 0.17);
const ACCENT: (f32, f32, f32) = (0.36, 0.36, 0.94);

fn cat_color(c: &str) -> (f32, f32, f32) {
    let hex = match c {
        "claim" => 0x2563eb,
        "method" => 0x7c3aed,
        "result" => 0x16a34a,
        "limitation" => 0xd97706,
        "definition" => 0x0d9488,
        "question" => 0xdb2777,
        "reference" => 0x6b7280,
        _ => 0x4f46e5,
    };
    (
        ((hex >> 16) & 255) as f32 / 255.0,
        ((hex >> 8) & 255) as f32 / 255.0,
        (hex & 255) as f32 / 255.0,
    )
}

fn char_w(c: char) -> f32 {
    match c as u32 {
        32..=126 => HELV[(c as u32 - 32) as usize] as f32 / 1000.0,
        _ => 0.556,
    }
}
fn text_w(s: &str, size: f32, bold: bool) -> f32 {
    s.chars().map(char_w).sum::<f32>() * size * if bold { 1.07 } else { 1.0 }
}

fn winansi(c: char) -> u8 {
    match c {
        '\u{201C}' => 0x93,
        '\u{201D}' => 0x94,
        '\u{2018}' => 0x91,
        '\u{2019}' => 0x92,
        '\u{2013}' => 0x96,
        '\u{2014}' => 0x97,
        '\u{2026}' => 0x85,
        '\u{2022}' => 0x95,
        '\u{2212}' => b'-',
        '\u{00A0}'..='\u{00FF}' => c as u32 as u8,
        ' '..='~' => c as u8,
        '\t' | '\n' | '\r' => b' ',
        _ => b'?',
    }
}

fn esc(s: &str) -> String {
    let mut o = String::new();
    for c in s.chars() {
        let b = winansi(c);
        match b {
            b'(' | b')' | b'\\' => {
                o.push('\\');
                o.push(b as char);
            }
            32..=126 => o.push(b as char),
            _ => o.push_str(&format!("\\{:03o}", b)),
        }
    }
    o
}

#[derive(Clone, Copy, PartialEq)]
enum Font {
    Regular,
    Bold,
    Italic,
}
impl Font {
    fn res(self) -> &'static str {
        match self {
            Font::Regular => "F1",
            Font::Bold => "F2",
            Font::Italic => "F3",
        }
    }
}

struct Doc {
    pages: Vec<String>,
    cur: String,
    y: f32,
}

impl Doc {
    fn new() -> Self {
        Doc { pages: vec![], cur: String::new(), y: H - M }
    }
    fn new_page(&mut self) {
        self.pages.push(std::mem::take(&mut self.cur));
        self.y = H - M;
    }
    fn ensure(&mut self, need: f32) {
        if self.y - need < M + 14.0 {
            self.new_page();
        }
    }
    fn text(&mut self, f: Font, size: f32, c: (f32, f32, f32), x: f32, y: f32, s: &str) {
        self.cur.push_str(&format!(
            "BT /{} {} Tf {:.3} {:.3} {:.3} rg {:.2} {:.2} Td ({}) Tj ET\n",
            f.res(), size, c.0, c.1, c.2, x, y, esc(s)
        ));
    }
    fn rect(&mut self, c: (f32, f32, f32), x: f32, y: f32, w: f32, h: f32) {
        self.cur.push_str(&format!(
            "{:.3} {:.3} {:.3} rg {:.2} {:.2} {:.2} {:.2} re f\n",
            c.0, c.1, c.2, x, y, w, h
        ));
    }
    fn wrap(s: &str, f: Font, size: f32, maxw: f32) -> Vec<String> {
        let bold = f == Font::Bold;
        let mut lines = vec![];
        let mut line = String::new();
        for word in s.split_whitespace() {
            // break words that are wider than a whole line
            let mut word = word.to_string();
            while text_w(&word, size, bold) > maxw {
                let mut cut = String::new();
                for ch in word.chars() {
                    if text_w(&format!("{cut}{ch}"), size, bold) > maxw {
                        break;
                    }
                    cut.push(ch);
                }
                if cut.is_empty() {
                    break;
                }
                if !line.is_empty() {
                    lines.push(std::mem::take(&mut line));
                }
                word = word[cut.len()..].to_string();
                lines.push(cut);
            }
            let cand = if line.is_empty() { word.clone() } else { format!("{line} {word}") };
            if text_w(&cand, size, bold) > maxw && !line.is_empty() {
                lines.push(std::mem::take(&mut line));
                line = word;
            } else {
                line = cand;
            }
        }
        if !line.is_empty() {
            lines.push(line);
        }
        lines
    }
    /// Flowing paragraph with automatic page breaks.
    fn para(&mut self, s: &str, f: Font, size: f32, c: (f32, f32, f32), x: f32, maxw: f32) {
        let lead = size * 1.38;
        for l in Self::wrap(s, f, size, maxw) {
            self.ensure(lead);
            self.y -= lead;
            self.text(f, size, c, x, self.y, &l);
        }
    }
    fn heading(&mut self, s: &str) {
        self.ensure(60.0);
        self.y -= 14.0;
        self.y -= 15.0;
        self.text(Font::Bold, 13.0, INK, M, self.y, s);
        self.y -= 6.0;
        self.rect((0.88, 0.89, 0.94), M, self.y, W - 2.0 * M, 0.8);
        self.y -= 4.0;
    }
}

pub fn render(d: &SummaryExport) -> Vec<u8> {
    let mut doc = Doc::new();
    let cw = W - 2.0 * M;

    // title block
    doc.rect(ACCENT, M, doc.y - 3.0, 36.0, 3.0);
    doc.y -= 24.0;
    for l in Doc::wrap(&d.title, Font::Bold, 19.0, cw) {
        doc.y -= 24.0;
        doc.text(Font::Bold, 19.0, INK, M, doc.y, &l);
    }
    doc.y -= 6.0;
    let sub = if d.model.is_empty() {
        "Annotation summary".to_string()
    } else {
        format!("Annotation summary \u{2022} generated locally with {}", d.model)
    };
    doc.para(&sub, Font::Regular, 9.5, GRAY, M, cw);

    if let Some(t) = &d.tldr {
        doc.heading("TL;DR");
        doc.para(&t.one_liner, Font::Bold, 12.0, INK, M, cw);
        doc.y -= 4.0;
        for b in &t.bullets {
            doc.ensure(16.0);
            let first_y = doc.y;
            doc.para(b, Font::Regular, 10.5, INK, M + 14.0, cw - 14.0);
            doc.text(Font::Regular, 10.5, ACCENT, M + 2.0, first_y - 10.5 * 1.38, "\u{2022}");
            doc.y -= 2.0;
        }
        if !t.eli5.is_empty() {
            doc.y -= 6.0;
            doc.para("In plain English", Font::Bold, 9.5, GRAY, M, cw);
            doc.para(&t.eli5, Font::Italic, 10.5, INK, M, cw);
        }
        if !t.keywords.is_empty() {
            doc.y -= 6.0;
            doc.para(&format!("Topics: {}", t.keywords.join(", ")), Font::Regular, 9.5, GRAY, M, cw);
        }
    }

    let acrs: Vec<&Acronym> = d.acronyms.iter().collect();
    if !acrs.is_empty() {
        doc.heading("Acronyms");
        for a in acrs {
            let long = if a.long.is_empty() { "Not defined in the paper".to_string() } else { a.long.clone() };
            let meta = match a.source.as_str() {
                "paper" => format!("defined in paper \u{2022} {}x \u{2022} first on p. {}", a.count, a.first_page),
                "inferred" => format!("inferred by the model \u{2022} {}x \u{2022} first on p. {}", a.count, a.first_page),
                _ => format!("{}x \u{2022} first on p. {}", a.count, a.first_page),
            };
            let lines = Doc::wrap(&long, Font::Regular, 10.5, cw - 80.0);
            doc.ensure(lines.len() as f32 * 14.5 + 16.0);
            let top = doc.y;
            doc.text(Font::Bold, 10.5, ACCENT, M, top - 14.0, &a.short);
            for l in &lines {
                doc.y -= 14.5;
                doc.text(Font::Regular, 10.5, INK, M + 80.0, doc.y, l);
            }
            doc.y -= 11.0;
            doc.text(Font::Regular, 8.5, GRAY, M + 80.0, doc.y, &meta);
            doc.y -= 6.0;
        }
    }

    if !d.annotations.is_empty() {
        doc.heading(&format!("Annotations ({})", d.annotations.len()));
        let mut anns: Vec<&Annotation> = d.annotations.iter().collect();
        anns.sort_by_key(|a| (a.page, a.id));
        let mut last_page = 0;
        let tw = cw - 16.0;
        for a in anns {
            let col = cat_color(&a.category);
            let q = Doc::wrap(&format!("\u{201C}{}\u{201D}", a.quote), Font::Italic, 9.0, tw);
            let main = if !a.detail.is_empty() { a.detail.as_str() } else { a.note.as_str() };
            let body = Doc::wrap(main, Font::Regular, 10.0, tw);
            let extra = if !a.detail.is_empty() && !a.note.is_empty() {
                Doc::wrap(&format!("Margin note: {}", a.note), Font::Italic, 9.5, tw)
            } else {
                vec![]
            };
            let h = 13.0 + q.len() as f32 * 11.5 + (body.len() + extra.len()) as f32 * 13.0 + 8.0;
            doc.ensure(h + if a.page != last_page { 22.0 } else { 0.0 });
            if a.page != last_page {
                last_page = a.page;
                doc.y -= 8.0;
                doc.y -= 11.0;
                doc.text(Font::Bold, 10.0, GRAY, M, doc.y, &format!("PAGE {}", a.page));
                doc.y -= 5.0;
            }
            let top = doc.y;
            doc.rect(col, M, top - h + 4.0, 3.0, h - 4.0);
            let x = M + 14.0;
            doc.y -= 11.0;
            let mut label = format!("{} \u{2022} {}", a.category.to_uppercase(), a.kind);
            if a.severity == "major" || a.severity == "minor" {
                label.push_str(&format!(" \u{2022} {}", a.severity));
            }
            doc.text(Font::Bold, 8.0, col, x, doc.y, &label);
            for l in &q {
                doc.y -= 11.5;
                doc.text(Font::Italic, 9.0, GRAY, x, doc.y, l);
            }
            for l in &body {
                doc.y -= 13.0;
                doc.text(Font::Regular, 10.0, INK, x, doc.y, l);
            }
            for l in &extra {
                doc.y -= 13.0;
                doc.text(Font::Italic, 9.5, GRAY, x, doc.y, l);
            }
            doc.y = top - h;
        }
    }

    doc.new_page();
    let pages = std::mem::take(&mut doc.pages);
    let pages: Vec<String> = pages.into_iter().filter(|p| !p.trim().is_empty()).collect();
    let n = pages.len().max(1);
    let short: String = d.title.chars().take(60).collect();

    // assemble the file
    let mut out: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offs: Vec<usize> = vec![];
    let mut obj = |out: &mut Vec<u8>, id: usize, body: &str| {
        let _ = id;
        offs.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", offs.len(), body).as_bytes());
    };
    let kids: String = (0..n).map(|i| format!("{} 0 R", 7 + 2 * i)).collect::<Vec<_>>().join(" ");
    obj(&mut out, 1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(&mut out, 2, &format!("<< /Type /Pages /Kids [{kids}] /Count {n} >>"));
    for f in ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique"] {
        obj(&mut out, 0, &format!("<< /Type /Font /Subtype /Type1 /BaseFont /{f} /Encoding /WinAnsiEncoding >>"));
    }
    for (i, p) in pages.iter().enumerate() {
        let mut content = p.clone();
        content.push_str(&format!(
            "BT /F1 8 Tf 0.55 0.58 0.65 rg {:.2} 30 Td ({}) Tj ET\nBT /F1 8 Tf 0.55 0.58 0.65 rg {:.2} 30 Td ({}) Tj ET\n",
            M, esc(&format!("neuron7  |  {short}")),
            W - M - 40.0, esc(&format!("Page {} of {}", i + 1, n)),
        ));
        obj(&mut out, 0, &format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content));
        obj(&mut out, 0, &format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Contents {} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>",
            6 + 2 * i
        ));
    }
    // objects were numbered by push order: 1,2,3,4,5 then (content, page) pairs = 6,7 / 8,9 ...
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offs.len() + 1).as_bytes());
    for o in &offs {
        out.extend_from_slice(format!("{:010} 00000 n \n", o).as_bytes());
    }
    out.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", offs.len() + 1, xref).as_bytes(),
    );
    out
}
