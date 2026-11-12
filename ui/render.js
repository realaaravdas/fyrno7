// Annotation renderers: "sharpie" (hand-drawn) and "pro" (clean review comments).
const NS = "http://www.w3.org/2000/svg";

export const CAT_COLORS = {
  claim: "#3d5a80", method: "#5f6b3a", result: "#2f6b4f", limitation: "#b06a1a",
  definition: "#3f6f73", question: "#8a4a62", reference: "#6b6358", insight: "#54516b",
};
// Category colours on the white page (highlights) use CAT_COLORS. The dark app chrome needs lighter tints of the same hues.
export const CAT_UI_DARK = {
  claim: "#86a9d6", method: "#a8b873", result: "#6fc79a", limitation: "#e2a553",
  definition: "#6fbcc0", question: "#d891ad", reference: "#a39d92", insight: "#9aa3c7",
};
export const catUI = (c) => (document.documentElement.dataset.theme === "light" ? CAT_COLORS[c] : CAT_UI_DARK[c]) || "#a39d92";
export const CAT_LABEL = {
  claim: "Claim", method: "Method", result: "Result", limitation: "Limitation",
  definition: "Definition", question: "Question", reference: "Reference", insight: "Insight",
};

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const f = (n) => Math.round(n * 10) / 10;

/* ---------- hand-drawn primitives ---------- */
function wobblyLine(x0, y0, x1, y1, r, amp = 1.6) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 38));
  let d = `M${f(x0 + (r() - 0.5) * 2)},${f(y0 + (r() - 0.5) * 2)}`;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t + (r() - 0.5) * amp * 2;
    const cx = x0 + (x1 - x0) * (t - 0.5 / n), cy = y0 + (y1 - y0) * (t - 0.5 / n) + (r() - 0.5) * amp * 2.4;
    d += ` Q${f(cx)},${f(cy)} ${f(x)},${f(y)}`;
  }
  return d;
}
function squiggle(x0, y, x1, r, amp = 2.6) {
  const step = 7;
  let d = `M${f(x0)},${f(y)}`;
  for (let x = x0, up = true; x < x1; x += step, up = !up) {
    d += ` Q${f(x + step / 2)},${f(y + (up ? -amp : amp) + (r() - 0.5))} ${f(Math.min(x + step, x1))},${f(y)}`;
  }
  return d;
}
function roughEllipse(cx, cy, rx, ry, r) {
  const pts = [], start = -0.5 + r() * 0.6, turns = 1.12 + r() * 0.1, N = 46;
  for (let i = 0; i <= N; i++) {
    const t = start + (i / N) * Math.PI * 2 * turns;
    const k = 1 + (i / N) * 0.07 + (r() - 0.5) * 0.035;
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
  }
  return "M" + pts.map((p) => `${f(p[0])},${f(p[1])}`).join(" L");
}
function roughBox(x, y, w, h, r) {
  const j = () => (r() - 0.5) * 3, o = 4;
  return `M${f(x + j())},${f(y + j())} L${f(x + w + o)},${f(y + j())} L${f(x + w + j())},${f(y + h + j())} L${f(x - o)},${f(y + h + j())} L${f(x + j())},${f(y - o)}`;
}
function starPath(cx, cy, R) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? R * 0.45 : R;
    d += (i ? " L" : "M") + f(cx + Math.cos(a) * rad) + "," + f(cy + Math.sin(a) * rad);
  }
  return d + " Z";
}
function arrow(parent, x0, y0, x1, y1, color, r, width = 1.8) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(26, len * 0.18) * (r() > 0.5 ? 1 : -1);
  const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
  el("path", { d: `M${f(x0)},${f(y0)} Q${f(cx)},${f(cy)} ${f(x1)},${f(y1)}`, stroke: color, "stroke-width": width, "stroke-linecap": "round", fill: "none" }, parent);
  const ang = Math.atan2(y1 - cy, x1 - cx), h = 7;
  el("path", { d: `M${f(x1 - Math.cos(ang - 0.45) * h)},${f(y1 - Math.sin(ang - 0.45) * h)} L${f(x1)},${f(y1)} L${f(x1 - Math.cos(ang + 0.45) * h)},${f(y1 - Math.sin(ang + 0.45) * h)}`, stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }, parent);
}

/* ---------- sharpie style definitions ---------- */
const INK = { blue: "#1d3fbf", red: "#d11d2b", green: "#13803b", black: "#1b1b1b", purple: "#7e22ce", orange: "#c2410c" };
const KIND_STYLE = {
  highlight: { ink: "blue", mark: "" },
  underline: { ink: "blue", mark: "" },
  circle: { ink: "red", mark: "" },
  question: { ink: "red", mark: "?" },
  star: { ink: "orange", mark: "★" },
  doubt: { ink: "red", mark: "hmm" },
  define: { ink: "green", mark: "def." },
  link: { ink: "purple", mark: "" },
};
const HILITE = ["rgba(255,235,59,.55)", "rgba(255,171,64,.45)", "rgba(105,240,174,.45)", "rgba(255,128,171,.4)"];

/** Place note elements in a gutter column without overlapping. */
function stack(items, minY, maxY) {
  items.sort((a, b) => a.want - b.want);
  let y = minY;
  for (const it of items) {
    it.top = Math.max(it.want, y);
    y = it.top + it.height + 8;
  }
  const over = y - 8 - maxY;
  if (over > 0) { // shift upward if we ran past the page bottom
    for (let i = items.length - 1, lim = maxY; i >= 0; i--) { items[i].top = Math.min(items[i].top, lim - items[i].height); lim = items[i].top - 8; }
  }
}

/**
 * ctx: { svg, notes, gutter, pageW, pageH, items:[{ann, rects}], onSelect }
 * rects are in page-local pixels; gutter is added here.
 */
export function drawSharpie(ctx) {
  const { svg, notes, gutter, pageW, pageH, items } = ctx;
  const g = el("g", { filter: "url(#roughen)" }, svg);
  const left = [], right = [];
  let loadL = 0, loadR = 0;

  for (const { ann, rects } of items) {
    if (!rects.length) continue;
    const r = rng(ann.id * 7919 + 13);
    const st = KIND_STYLE[ann.kind] || KIND_STYLE.highlight;
    const ink = INK[st.ink];
    const grp = el("g", { "data-id": ann.id, class: "ann-g" }, g);
    const R = rects.map((q) => ({ x: q.x + gutter, y: q.y, w: q.w, h: q.h }));
    const first = R[0], last = R[R.length - 1];

    for (const q of R) {
      const yb = q.y + q.h * 0.98;
      switch (ann.kind) {
        case "highlight":
          el("path", { d: wobblyLine(q.x - 2, q.y + q.h * 0.55, q.x + q.w + 3, q.y + q.h * 0.55 + (r() - 0.5) * 2, r, 1.2), stroke: HILITE[ann.id % HILITE.length], "stroke-width": f(q.h * 0.96), "stroke-linecap": "round", fill: "none", style: "mix-blend-mode:multiply" }, grp);
          break;
        case "underline":
        case "star":
          el("path", { d: wobblyLine(q.x - 1, yb + 1, q.x + q.w + 2, yb + 1, r), stroke: ink, "stroke-width": 2.7, "stroke-linecap": "round", fill: "none" }, grp);
          if (ann.kind === "star") el("path", { d: wobblyLine(q.x + 2, yb + 5, q.x + q.w, yb + 5, r), stroke: ink, "stroke-width": 2.2, "stroke-linecap": "round", fill: "none" }, grp);
          break;
        case "question":
        case "doubt":
          el("path", { d: squiggle(q.x, yb + 1.5, q.x + q.w, r), stroke: ink, "stroke-width": 2.4, "stroke-linecap": "round", fill: "none" }, grp);
          break;
        case "link":
          el("path", { d: wobblyLine(q.x, yb + 1, q.x + q.w, yb + 1, r), stroke: ink, "stroke-width": 2.4, "stroke-dasharray": "7 5", "stroke-linecap": "round", fill: "none" }, grp);
          break;
        case "define":
          el("path", { d: roughBox(q.x - 3, q.y + 1, q.w + 6, q.h - 1, r), stroke: ink, "stroke-width": 2.4, "stroke-linejoin": "round", fill: "none" }, grp);
          break;
        case "circle":
          if (R.length === 1 || q === first) {
            const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
            el("path", { d: roughEllipse(cx, cy, q.w / 2 + 9, q.h / 2 + 5.5, r), stroke: ink, "stroke-width": 2.8, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }, grp);
          } else el("path", { d: wobblyLine(q.x, yb + 1, q.x + q.w, yb + 1, r), stroke: ink, "stroke-width": 2.6, "stroke-linecap": "round", fill: "none" }, grp);
          break;
      }
      el("rect", { x: q.x - 4, y: q.y - 2, width: q.w + 8, height: q.h + 6, class: "hit", "data-id": ann.id }, svg);
    }
    if (ann.kind === "star") el("path", { d: starPath(first.x - 12, first.y + first.h / 2, 8.5), fill: "#ffb703", stroke: ink, "stroke-width": 1.8, "stroke-linejoin": "round" }, grp);

    // margin note + connector
    const text = ann.note || "";
    const mark = st.mark && ann.kind !== "star" ? st.mark : "";
    if (!text && !mark) continue;
    const cx = first.x + first.w / 2;
    let side = cx < gutter + pageW / 2 ? "L" : "R";
    if (side === "L" && loadL > loadR + 2) side = "R"; else if (side === "R" && loadR > loadL + 2) side = "L";
    side === "L" ? loadL++ : loadR++;
    const div = document.createElement("div");
    div.className = `note-s ${st.ink}`;
    div.dataset.id = ann.id;
    div.style.width = `${gutter - 22}px`;
    const rot = (r() - 0.5) * 5;
    div.style.transform = `rotate(${f(rot)}deg)`;
    if (mark && (ann.kind === "question" || ann.kind === "doubt" || ann.kind === "define")) {
      const m = document.createElement("span"); m.className = "mk"; m.textContent = mark === "?" ? "???" : mark; div.appendChild(m);
    }
    if (text) div.appendChild(document.createTextNode(text));
    div.style.left = side === "L" ? "8px" : `${gutter + pageW + 14}px`;
    div.style.top = "-9999px";
    notes.appendChild(div);
    (side === "L" ? left : right).push({ div, ann, side, want: first.y + first.h / 2 - 12, height: div.offsetHeight, anchor: side === "L" ? { x: first.x - 5, y: first.y + first.h / 2 } : { x: last.x + last.w + 6, y: last.y + last.h / 2 }, ink, r });
  }

  for (const [col, isLeft] of [[left, true], [right, false]]) {
    stack(col, 6, pageH - 6);
    for (const it of col) {
      it.div.style.top = `${f(it.top)}px`;
      const nx = isLeft ? gutter - 14 : gutter + pageW + 10, ny = it.top + Math.min(it.height, 24) / 2 + 2;
      arrow(g, nx, ny, it.anchor.x, it.anchor.y, it.ink, it.r, 1.7);
      it.div.addEventListener("click", () => ctx.onSelect(it.ann.id));
    }
  }
}

const SEV = { info: "Note", minor: "Minor", major: "Major" };

export function drawPro(ctx) {
  const { svg, notes, gutter, pageW, pageH, items } = ctx;
  const left = [], right = [];
  let loadL = 0, loadR = 0;
  for (const { ann, rects } of items) {
    if (!rects.length) continue;
    const col = CAT_COLORS[ann.category] || CAT_COLORS.insight;
    const grp = el("g", { "data-id": ann.id, class: "ann-g" }, svg);
    const R = rects.map((q) => ({ x: q.x + gutter, y: q.y, w: q.w, h: q.h }));
    for (const q of R) {
      el("rect", { x: f(q.x - 1), y: f(q.y), width: f(q.w + 2), height: f(q.h), rx: 2.5, fill: col, "fill-opacity": ann.kind === "highlight" || ann.kind === "star" ? 0.3 : 0.18, style: "mix-blend-mode:multiply" }, grp);
      el("rect", { x: f(q.x - 1), y: f(q.y + q.h - 1.6), width: f(q.w + 2), height: 1.8, fill: col, "fill-opacity": 0.85 }, grp);
      el("rect", { x: q.x - 2, y: q.y - 2, width: q.w + 4, height: q.h + 4, class: "hit", "data-id": ann.id }, svg);
    }
    const first = R[0], last = R[R.length - 1];
    // numbered badge
    const bx = last.x + last.w + 1, by = last.y - 3;
    el("circle", { cx: f(bx), cy: f(by), r: 7.5, fill: col }, grp);
    const t = el("text", { x: f(bx), y: f(by + 3.2), "text-anchor": "middle", "font-size": 9, "font-weight": 700, fill: "#fff", "font-family": "Segoe UI, system-ui, sans-serif", style: "stroke:none" }, grp);
    t.textContent = String(ann.id);

    const body = ann.detail || ann.note;
    if (!body) continue;
    const cx = first.x + first.w / 2;
    let side = cx < gutter + pageW / 2 ? "L" : "R";
    if (side === "L" && loadL > loadR + 2) side = "R"; else if (side === "R" && loadR > loadL + 2) side = "L";
    side === "L" ? loadL++ : loadR++;
    const div = document.createElement("div");
    div.className = "note-p";
    div.dataset.id = ann.id;
    div.style.setProperty("--c", col);
    div.style.width = `${gutter - 22}px`;
    div.style.left = side === "L" ? "8px" : `${gutter + pageW + 14}px`;
    div.style.top = "-9999px";
    const hd = document.createElement("div"); hd.className = "hd";
    hd.innerHTML = `<span class="n">${ann.id}</span><span>${CAT_LABEL[ann.category] || ""}</span><span class="sev ${ann.severity}">${SEV[ann.severity] || ""}</span>`;
    const p = document.createElement("div"); p.textContent = body;
    div.append(hd, p);
    notes.appendChild(div);
    (side === "L" ? left : right).push({ div, ann, want: first.y - 2, height: div.offsetHeight, anchor: side === "L" ? { x: first.x - 2, y: first.y + first.h / 2 } : { x: bx + 8, y: by }, col, isLeft: side === "L" });
  }
  for (const [col, isLeft] of [[left, true], [right, false]]) {
    stack(col, 6, pageH - 6);
    for (const it of col) {
      it.div.style.top = `${f(it.top)}px`;
      const nx = isLeft ? gutter - 14 : gutter + pageW + 12, ny = it.top + 13;
      el("path", { d: `M${nx},${f(ny)} L${f(nx + (isLeft ? 8 : -8))},${f(ny)} L${f(it.anchor.x)},${f(it.anchor.y)}`, stroke: it.col, "stroke-width": 1, "stroke-opacity": 0.55, fill: "none" }, svg);
      it.div.addEventListener("click", () => ctx.onSelect(it.ann.id));
    }
  }
}

/** Dotted underline + native tooltip for each decoded acronym occurrence. */
export function drawAcronyms(ctx, hits) {
  const { svg, gutter } = ctx;
  for (const { acr, rects } of hits) {
    for (const q of rects) {
      const x = q.x + gutter, y = q.y + q.h;
      el("path", { d: `M${f(x)},${f(y)} L${f(x + q.w)},${f(y)}`, stroke: "#0ea5e9", "stroke-width": 2, "stroke-dasharray": "1 3", "stroke-linecap": "round" }, svg);
      const hit = el("rect", { x: f(x), y: f(q.y), width: f(q.w), height: f(q.h + 3), class: "hit" }, svg);
      const t = el("title", {}, hit);
      t.textContent = `${acr.short}: ${acr.long}${acr.source === "inferred" ? " (inferred)" : ""}`;
    }
  }
}

export function addDefs(svg) {
  const defs = el("defs", {}, svg);
  const flt = el("filter", { id: "roughen", x: "-5%", y: "-5%", width: "110%", height: "110%" }, defs);
  el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.035", numOctaves: "2", seed: "4", result: "n" }, flt);
  el("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: "2.6", xChannelSelector: "R", yChannelSelector: "G" }, flt);
}
