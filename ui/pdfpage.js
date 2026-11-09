// Text model of a rendered pdf.js page: finds quotes and turns them into pixel rectangles.
import * as pdfjs from "./vendor/pdf.min.mjs";

const LIG = { "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

export function normalize(s) {
  const chars = [], map = [];
  let i = 0;
  for (const c of s) {
    const lig = LIG[c];
    if (lig) { for (const e of lig) { chars.push(e); map.push(i); } }
    else if (/[\p{L}\p{N}]/u.test(c)) { for (const l of c.toLowerCase()) { chars.push(l); map.push(i); } }
    i += c.length;
  }
  return { str: chars.join(""), map };
}

export async function buildModel(page) {
  const tc = await page.getTextContent();
  const items = [];
  let raw = "";
  for (const it of tc.items) {
    if (typeof it.str !== "string") continue;
    const start = raw.length;
    raw += it.str;
    items.push({ start, end: raw.length, transform: it.transform, width: it.width, height: it.height });
    if (it.hasEOL) raw += "\n";
  }
  return { raw, items, norm: normalize(raw) };
}

/** Locate a quote; returns [start, end) offsets into model.raw or null. */
export function findQuote(model, quote) {
  const nq = normalize(quote).str;
  if (nq.length < 6) return null;
  const hay = model.norm.str;
  let s = hay.indexOf(nq), e;
  if (s >= 0) e = s + nq.length;
  else if (nq.length >= 28) {
    s = hay.indexOf(nq.slice(0, 24));
    if (s >= 0) e = Math.min(s + nq.length, hay.length);
    else {
      const p = hay.indexOf(nq.slice(-24));
      if (p < 0) return null;
      e = p + 24; s = Math.max(0, e - nq.length);
    }
  } else return null;
  const a = model.norm.map[s], b = model.norm.map[e - 1] + 1;
  return a == null || b == null ? null : [a, b];
}

export function findWord(model, word, limit = 8) {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "g");
  const out = [];
  let m;
  while ((m = re.exec(model.raw)) && out.length < limit) out.push([m.index, m.index + m[0].length - (m[0].endsWith("s") && !word.endsWith("s") ? 1 : 0)]);
  return out;
}

/** Pixel rectangles (one per text line) covering model.raw[a:b). */
export function rectsFor(model, a, b, viewport) {
  const raw = [];
  for (const it of model.items) {
    if (it.end <= a || it.start >= b || it.end === it.start) continue;
    const len = it.end - it.start;
    const f0 = Math.max(0, a - it.start) / len, f1 = Math.min(len, b - it.start) / len;
    const t = pdfjs.Util.transform(viewport.transform, it.transform);
    const h = Math.hypot(t[2], t[3]);
    if (Math.abs(t[1]) > 0.5 * Math.abs(t[0])) continue; // rotated text: skip
    const w = it.width * viewport.scale;
    raw.push({ x: t[4] + f0 * w, y: t[5] - h * 0.84, w: Math.max(2, (f1 - f0) * w), h: h * 1.04 });
  }
  raw.sort((p, q) => p.y - q.y || p.x - q.x);
  const lines = [];
  for (const r of raw) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.y - r.y) < Math.max(L.h, r.h) * 0.5 && r.x <= L.x + L.w + L.h * 2) {
      const x2 = Math.max(L.x + L.w, r.x + r.w);
      L.x = Math.min(L.x, r.x); L.w = x2 - L.x; L.h = Math.max(L.h, r.h); L.y = Math.min(L.y, r.y);
    } else lines.push({ ...r });
  }
  return lines;
}
