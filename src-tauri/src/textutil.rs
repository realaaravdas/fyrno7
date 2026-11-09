//! Text normalisation used to verify that an LLM "quote" really exists on a page.

pub struct Norm {
    pub chars: Vec<char>,
    /// For every normalised char, the index (in chars) of the original character.
    pub map: Vec<usize>,
}

pub fn normalize(s: &str) -> Norm {
    let mut chars = Vec::with_capacity(s.len());
    let mut map = Vec::with_capacity(s.len());
    for (i, c) in s.chars().enumerate() {
        let lig = match c {
            '\u{FB01}' => "fi",
            '\u{FB02}' => "fl",
            '\u{FB00}' => "ff",
            '\u{FB03}' => "ffi",
            '\u{FB04}' => "ffl",
            '\u{FB05}' | '\u{FB06}' => "st",
            _ => "",
        };
        if !lig.is_empty() {
            for e in lig.chars() {
                chars.push(e);
                map.push(i);
            }
        } else if c.is_alphanumeric() {
            for l in c.to_lowercase() {
                chars.push(l);
                map.push(i);
            }
        }
    }
    Norm { chars, map }
}

fn find_sub(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Find `quote` inside `page` (ignoring case, spacing, punctuation, hyphenation).
/// Returns the matching slice of the *original* page text, whitespace-collapsed.
/// Tolerates a quote whose tail or head was slightly paraphrased.
pub fn locate(page: &str, norm: &Norm, quote: &str) -> Option<String> {
    let nq = normalize(quote).chars;
    if nq.len() < 6 {
        return None;
    }
    let (s, e) = if let Some(s) = find_sub(&norm.chars, &nq) {
        (s, s + nq.len())
    } else if nq.len() >= 28 {
        let k = 24;
        if let Some(s) = find_sub(&norm.chars, &nq[..k]) {
            (s, (s + nq.len()).min(norm.chars.len()))
        } else if let Some(p) = find_sub(&norm.chars, &nq[nq.len() - k..]) {
            let end = p + k;
            (end.saturating_sub(nq.len()), end)
        } else {
            return None;
        }
    } else {
        return None;
    };
    let orig: Vec<char> = page.chars().collect();
    let a = *norm.map.get(s)?;
    let b = *norm.map.get(e - 1)? + 1;
    let slice: String = orig.get(a..b.min(orig.len()))?.iter().collect();
    let out = collapse_ws(&slice);
    if out.chars().count() > 320 {
        None
    } else {
        Some(out)
    }
}
