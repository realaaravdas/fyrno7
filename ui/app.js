import * as pdfjs from "./vendor/pdf.min.mjs";
import { buildModel, findQuote, findWord, rectsFor } from "./pdfpage.js";
import { addDefs, drawSharpie, drawPro, drawAcronyms, CAT_COLORS, CAT_LABEL } from "./render.js";
import { backend } from "./backend.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const G = 160; // margin gutter width (px) on each side of a page

const DEFAULTS = { baseUrl: "http://localhost:1234", apiKey: "", model: "", temperature: 0.3, chunkChars: 9000, maxTokens: 3500 };
const S = {
  settings: { ...DEFAULTS, ...loadJSON("neuron7.settings", {}) },
  prefs: { density: "balanced", level: "grad", ...loadJSON("neuron7.prefs", {}) },
  path: null, name: "", info: null, doc: null, pv: [],
  result: null, removed: new Set(), hiddenCats: new Set(),
  selected: null, fit: 1, zoom: 1, style: "sharpie", showAnn: true, showAcr: false, tab: "notes",
  models: [], connected: false, running: false, observer: null, ranFor: null,
};

function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function toast(msg, err = false, ms = 4500) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ------------------------------------------------------------------ connection */
async function refreshConnection(quiet = true) {
  const dot = $("#connDot"), txt = $("#connText");
  try {
    S.models = await backend.checkConnection(S.settings.baseUrl, S.settings.apiKey);
    S.connected = true;
    if (!S.models.includes(S.settings.model)) {
      S.settings.model = S.models.find((m) => /gemma/i.test(m)) || S.models[0] || "";
      saveJSON("neuron7.settings", S.settings);
    }
    dot.className = "dot ok";
    txt.textContent = S.settings.model ? shortModel(S.settings.model) : "Connected · no model loaded";
    $("#sStatus").className = "status-line ok";
    $("#sStatus").textContent = `Connected. ${S.models.length} model(s) available.`;
  } catch (e) {
    S.connected = false; S.models = [];
    dot.className = "dot bad"; txt.textContent = "Local model offline";
    $("#sStatus").className = "status-line bad";
    $("#sStatus").textContent = String(e);
    if (!quiet) toast(String(e), true);
  }
  fillModelSelect();
  updateAnalyzeButton();
}
const shortModel = (m) => (m.length > 28 ? m.slice(0, 26) + "…" : m);
function fillModelSelect() {
  const sel = $("#sModel");
  sel.innerHTML = "";
  const list = S.models.length ? S.models : S.settings.model ? [S.settings.model] : [];
  for (const m of list) sel.add(new Option(m, m, false, m === S.settings.model));
  if (!list.length) sel.add(new Option("(no models detected)", ""));
}

/* ------------------------------------------------------------------ settings modal */
function openSettings() {
  $("#sBase").value = S.settings.baseUrl; $("#sKey").value = S.settings.apiKey;
  $("#sTemp").value = S.settings.temperature; $("#sChunk").value = S.settings.chunkChars; $("#sTokens").value = S.settings.maxTokens;
  fillModelSelect();
  $("#settingsModal").hidden = false;
}
function readSettingsForm() {
  S.settings = {
    baseUrl: $("#sBase").value.trim() || DEFAULTS.baseUrl, apiKey: $("#sKey").value,
    model: $("#sModel").value || S.settings.model,
    temperature: clampNum($("#sTemp").value, 0, 1.5, 0.3), chunkChars: clampNum($("#sChunk").value, 2000, 60000, 9000),
    maxTokens: clampNum($("#sTokens").value, 512, 16000, 3500),
  };
}
const clampNum = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/* ------------------------------------------------------------------ paper loading */
async function openPaper(path) {
  if (!path) return;
  try {
    const bytes = await backend.readPdf(path);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    S.path = path; S.doc = doc; S.name = path.split(/[\\/]/).pop();
    S.result = null; S.removed.clear(); S.hiddenCats.clear(); S.selected = null; S.zoom = 1; S.ranFor = null;
    $("#docTitle").textContent = S.name;
    $("#emptyState").hidden = true;
    $("#toolbar").hidden = true;
    renderTab();
    await buildPages();
    $("#paperMeta").hidden = false;
    $("#paperMeta").innerHTML = `<b>${esc(S.name)}</b><span>${doc.numPages} pages · reading text…</span>`;
    updateAnalyzeButton();
    backend.inspectPdf(path).then((info) => {
      S.info = info;
      const warn = info.hasText ? "" : `<span class="warn">No selectable text found. This looks like a scan; run OCR first.</span>`;
      $("#paperMeta").innerHTML = `<b>${esc(info.title)}</b><span>${info.nPages} pages · ${(info.chars / 1000).toFixed(0)}k characters</span>${warn}`;
      updateAnalyzeButton();
    }).catch((e) => toast(String(e), true));
  } catch (e) {
    toast(`Could not open that PDF: ${e}`, true);
  }
}

async function buildPages() {
  const host = $("#pages");
  host.innerHTML = "";
  S.pv = [];
  if (S.observer) S.observer.disconnect();
  const first = await S.doc.getPage(1);
  const w1 = first.getViewport({ scale: 1 }).width;
  const avail = $("#viewer").clientWidth - 48 - 2 * G;
  S.fit = Math.min(1.9, Math.max(0.7, avail / w1));
  const scale = S.fit * S.zoom;
  $("#zoomLbl").textContent = Math.round(S.zoom * 100) + "%";

  S.observer = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) renderPage(S.pv[+en.target.dataset.i]);
  }, { root: $("#viewer"), rootMargin: "900px 0px" });

  for (let i = 0; i < S.doc.numPages; i++) {
    const page = i === 0 ? first : await S.doc.getPage(i + 1);
    const vp = page.getViewport({ scale });
    const wrap = document.createElement("div");
    wrap.className = "page-wrap"; wrap.dataset.i = i;
    wrap.style.width = `${Math.round(vp.width) + 2 * G}px`; wrap.style.height = `${Math.round(vp.height)}px`;
    wrap.innerHTML = `<div class="sheet" style="left:${G}px;width:${Math.round(vp.width)}px;height:${Math.round(vp.height)}px"></div>
      <svg class="ov" width="${Math.round(vp.width) + 2 * G}" height="${Math.round(vp.height)}"></svg><div class="notes"></div>
      <div class="page-label">Page ${i + 1}</div>`;
    host.appendChild(wrap);
    S.pv.push({ i, page, vp, wrap, sheet: $(".sheet", wrap), svg: $("svg", wrap), notes: $(".notes", wrap), rendered: false, model: null });
    S.observer.observe(wrap);
  }
  updatePageIndicator();
}

async function renderPage(pv) {
  if (!pv || pv.rendering || pv.rendered) return;
  pv.rendering = true;
  try {
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(pv.vp.width * dpr); canvas.height = Math.floor(pv.vp.height * dpr);
    canvas.style.width = `${Math.round(pv.vp.width)}px`; canvas.style.height = `${Math.round(pv.vp.height)}px`;
    await pv.page.render({ canvasContext: canvas.getContext("2d"), viewport: pv.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    pv.sheet.replaceChildren(canvas);
    pv.model = await buildModel(pv.page);
    pv.rendered = true;
    drawOverlay(pv);
  } catch (e) { console.error("render page", e); }
  pv.rendering = false;
}

/* ------------------------------------------------------------------ overlays */
function visibleAnns() {
  if (!S.result) return [];
  return S.result.annotations.filter((a) => !S.removed.has(a.id) && !S.hiddenCats.has(a.category));
}

function drawOverlay(pv) {
  pv.svg.replaceChildren(); pv.notes.replaceChildren();
  if (!pv.rendered || !S.result) return;
  const ctx = { svg: pv.svg, notes: pv.notes, gutter: G, pageW: pv.vp.width, pageH: pv.vp.height, onSelect: (id) => select(id, "page") };
  addDefs(pv.svg);
  pv.rects = pv.rects || new Map();
  if (S.showAnn) {
    const items = [];
    for (const ann of visibleAnns().filter((a) => a.page === pv.i + 1)) {
      let rects = pv.rects.get(ann.id);
      if (!rects) {
        const range = findQuote(pv.model, ann.quote);
        rects = range ? rectsFor(pv.model, range[0], range[1], pv.vp) : [];
        pv.rects.set(ann.id, rects);
      }
      if (rects.length) items.push({ ann, rects });
    }
    (S.style === "pro" ? drawPro : drawSharpie)({ ...ctx, items });
  }
  if (S.showAcr && S.result.acronyms.length) {
    const hits = [];
    for (const acr of S.result.acronyms.filter((a) => a.long)) {
      for (const [a, b] of findWord(pv.model, acr.short, 4)) hits.push({ acr, rects: rectsFor(pv.model, a, b, pv.vp) });
    }
    drawAcronyms(ctx, hits);
  }
  if (S.selected != null) markSelected();
}
const redrawAll = () => S.pv.forEach((pv) => pv.rendered && drawOverlay(pv));

function markSelected() {
  $$(".sel").forEach((e) => e.classList.remove("sel"));
  if (S.selected == null) return;
  $$(`[data-id="${S.selected}"]`).forEach((e) => e.classList.add("sel"));
}

async function select(id, from) {
  S.selected = id; markSelected();
  const ann = S.result?.annotations.find((a) => a.id === id);
  if (!ann) return;
  if (from === "list") {
    const pv = S.pv[ann.page - 1];
    pv.wrap.scrollIntoView({ block: "start" });
    await renderPage(pv);
    const rects = pv.rects?.get(id);
    const viewer = $("#viewer");
    if (rects?.length) viewer.scrollTo({ top: pv.wrap.offsetTop + rects[0].y - viewer.clientHeight / 3, behavior: "smooth" });
    markSelected();
  } else if (S.tab === "notes") {
    $(`.ann[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function updatePageIndicator() {
  const v = $("#viewer"), y = v.scrollTop + v.clientHeight / 3;
  let cur = 0;
  for (const pv of S.pv) if (pv.wrap.offsetTop <= y) cur = pv.i;
  $("#pageInd").textContent = S.doc ? `Page ${cur + 1} / ${S.doc.numPages}` : "";
}

/* ------------------------------------------------------------------ analysis */
function currentOptions() {
  const sharpie = $("#modeSharpie").checked, pro = $("#modePro").checked;
  return {
    annotate: sharpie || pro, professional: pro, companion: $("#modeCompanion").checked,
    tldr: $("#optTldr").checked, acronyms: $("#optAcr").checked,
    density: S.prefs.density, level: S.prefs.level,
  };
}
function updateAnalyzeButton() {
  const ok = S.doc && S.info?.hasText !== false && !S.running;
  $("#btnAnalyze").disabled = !ok;
  $("#btnAnalyze").textContent = S.running ? "Working…" : S.connected ? "Annotate paper" : "Annotate paper (model offline)";
}

async function analyze() {
  const o = currentOptions();
  if (!o.annotate && !o.companion && !o.tldr && !o.acronyms) return toast("Pick at least one mode or extra first.");
  await refreshConnection();
  if (!S.connected) { toast("Start your local model server first (see Settings).", true); return openSettings(); }
  if (!S.settings.model) { toast("No model is loaded in your server. Load a Gemma model, then try again.", true); return openSettings(); }

  S.running = true; updateAnalyzeButton();
  $("#btnCancel").hidden = false; $("#progress").hidden = false; setProgress(0, 1, "Starting…");
  try {
    const res = await backend.analyze({ path: S.path, settings: S.settings, options: o }, (p) => setProgress(p.done, p.total, p.message));
    S.result = res; S.removed.clear(); S.hiddenCats.clear(); S.selected = null;
    S.ranFor = { sharpie: $("#modeSharpie").checked, pro: o.professional, companion: o.companion };
    S.style = S.ranFor.sharpie ? "sharpie" : "pro";
    S.pv.forEach((pv) => (pv.rects = null));
    $("#docTitle").textContent = res.title || S.name;
    setupToolbar();
    S.tab = o.annotate ? "notes" : o.tldr ? "tldr" : o.companion ? "doc" : "acr";
    $("#panel").classList.remove("hidden");
    renderTab(); redrawAll();
    for (const w of res.warnings || []) toast(w, true, 9000);
    toast(`Done: ${res.annotations.length} annotations.`);
  } catch (e) {
    if (!String(e).includes("Cancelled")) toast(String(e), true, 9000);
  } finally {
    S.running = false; $("#btnCancel").hidden = true; $("#progress").hidden = true; updateAnalyzeButton();
  }
}
function setProgress(done, total, msg) {
  $("#barFill").style.width = `${Math.max(4, (done / Math.max(1, total)) * 100)}%`;
  $("#progText").textContent = msg;
}

function setupToolbar() {
  $("#toolbar").hidden = false;
  const r = S.ranFor;
  const seg = $("#segStyle");
  seg.querySelector('[data-v="sharpie"]').disabled = !r.sharpie;
  seg.querySelector('[data-v="pro"]').disabled = !r.pro;
  seg.hidden = !(r.sharpie || r.pro);
  $$("button", seg).forEach((b) => b.classList.toggle("on", b.dataset.v === S.style));
  $("#xMd").disabled = $("#xHtml").disabled = !S.result?.companionMd;
  $("#chkAcr").closest("label").hidden = !(S.result?.acronyms?.length);
  $("#chkAnn").closest("label").hidden = !S.result?.annotations?.length;
}

/* ------------------------------------------------------------------ side panel */
function renderTab() {
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  const body = $("#tabBody");
  const R = S.result;
  if (!R) { body.innerHTML = `<div class="placeholder">Open a paper and press <b>Annotate paper</b>.<br>Notes, the TL;DR, decoded acronyms and your companion document will appear here.</div>`; return; }
  ({ notes: renderNotes, tldr: renderTldr, acr: renderAcr, doc: renderDoc })[S.tab](body, R);
}

function renderNotes(body, R) {
  if (!R.annotations.length) { body.innerHTML = `<div class="placeholder">No annotations in this run.<br>Enable Sharpie or Professional mode and annotate again.</div>`; return; }
  const cats = [...new Set(R.annotations.map((a) => a.category))];
  const chips = cats.map((c) => `<button class="fchip ${S.hiddenCats.has(c) ? "" : "on"}" data-cat="${c}" style="--c:${CAT_COLORS[c]}"><i></i>${CAT_LABEL[c]}</button>`).join("");
  const list = R.annotations.filter((a) => !S.removed.has(a.id) && !S.hiddenCats.has(a.category));
  body.innerHTML = `<div class="filters">${chips}</div>` + (list.map((a) => `
    <div class="ann ${S.selected === a.id ? "sel" : ""}" data-id="${a.id}" style="--c:${CAT_COLORS[a.category]}">
      <div class="meta"><span class="cat">${CAT_LABEL[a.category]}</span><span>p. ${a.page}</span><span>${esc(a.kind)}</span>${a.severity === "major" ? '<span style="color:var(--danger);font-weight:700">major</span>' : ""}<button class="x" title="Remove annotation" data-del="${a.id}">✕</button></div>
      <q>${esc(a.quote)}</q>
      ${a.detail ? `<p>${esc(a.detail)}</p>` : ""}${a.note ? `<p ${a.detail ? 'style="color:var(--muted)"' : ""}>${a.detail ? "✎ " : ""}${esc(a.note)}</p>` : ""}
    </div>`).join("") || `<div class="placeholder">Everything is filtered out.</div>`);
}

function renderTldr(body, R) {
  const t = R.tldr;
  if (!t) { body.innerHTML = `<div class="placeholder">TL;DR was not generated. Enable it under Extras and run again.</div>`; return; }
  body.innerHTML = `<p class="tldr-one">${esc(t.oneLiner)}</p>
    <div class="tldr-sec"><h4>Key points</h4><ul>${t.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>
    ${t.eli5 ? `<div class="tldr-sec"><h4>In plain English</h4><div class="eli5">${esc(t.eli5)}</div></div>` : ""}
    ${t.keywords.length ? `<div class="tldr-sec"><h4>Topics</h4><div class="kw">${t.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</div></div>` : ""}`;
}

function renderAcr(body, R, filter = "") {
  if (!R.acronyms.length && !filter) { body.innerHTML = `<div class="placeholder">No acronyms found, or the decoder was off for this run.</div>`; return; }
  const q = filter.toLowerCase();
  const rows = R.acronyms.filter((a) => !q || a.short.toLowerCase().includes(q) || a.long.toLowerCase().includes(q));
  body.innerHTML = `<input class="acr-search" placeholder="Search ${R.acronyms.length} acronyms…" value="${esc(filter)}" />` +
    rows.map((a) => `<div class="acr"><b>${esc(a.short)}</b><div>${a.long ? esc(a.long) : '<span style="color:var(--muted)">Not defined in the paper</span>'}<span class="tag ${a.source}">${a.source === "paper" ? "defined in paper" : a.source === "inferred" ? "inferred" : "unknown"}</span></div><div class="meta">${a.count}× · first on p. ${a.firstPage}</div></div>`).join("");
  const inp = $(".acr-search", body);
  inp.addEventListener("input", () => { const pos = inp.selectionStart; renderAcr(body, R, inp.value); const n = $(".acr-search", body); n.focus(); n.setSelectionRange(pos, pos); });
}

function renderDoc(body, R) {
  if (!R.companionMd) { body.innerHTML = `<div class="placeholder">No companion document yet. Turn on <b>Companion document</b> and annotate again.</div>`; return; }
  body.innerHTML = `<div class="doc-md">${md(R.companionMd)}</div>`;
}

function md(src) {
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  const out = []; let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const line of src.split("\n")) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (line.trim()) { closeList(); out.push(`<p>${inline(line)}</p>`); }
    else closeList();
  }
  closeList();
  return out.join("\n");
}

/* ------------------------------------------------------------------ export */
async function exportAs(kind) {
  const R = S.result; const base = (S.name || "paper").replace(/\.pdf$/i, "");
  if (kind === "print") return printAnnotated();
  if (!R) return;
  if (kind === "pdf") {
    const path = await backend.saveDialog(`${base}-summary.pdf`, "pdf", "PDF");
    if (!path) return;
    try {
      await backend.exportSummary(path, { title: R.title || S.name, model: R.model || "", tldr: R.tldr, acronyms: R.acronyms, annotations: R.annotations.filter((a) => !S.removed.has(a.id) && !S.hiddenCats.has(a.category)) });
      toast(`Saved ${path.split(/[\\/]/).pop()}`);
    } catch (e) { toast(String(e), true); }
    return;
  }
  const defs = {
    md: [`${base}-companion.md`, "md", R.companionMd, "Markdown"],
    html: [`${base}-companion.html`, "html", htmlDoc(R), "HTML"],
    json: [`${base}-annotations.json`, "json", JSON.stringify({ title: R.title, model: R.model, annotations: R.annotations.filter((a) => !S.removed.has(a.id)), tldr: R.tldr, acronyms: R.acronyms }, null, 2), "JSON"],
  }[kind];
  const path = await backend.saveDialog(defs[0], defs[1], defs[3]);
  if (!path) return;
  try { await backend.saveText(path, defs[2]); toast(`Saved ${path.split(/[\\/]/).pop()}`); } catch (e) { toast(String(e), true); }
}
function htmlDoc(R) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(R.title)} – companion notes</title><style>
body{font:16px/1.6 Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1b1e28}h1{font-family:system-ui;letter-spacing:-.02em}h2{font-family:system-ui;font-size:19px;margin-top:2em;border-bottom:1px solid #e4e7f0;padding-bottom:4px}h3{font-family:system-ui}
blockquote{background:#ececff;border-left:4px solid #5b5bf0;margin:1em 0;padding:.6em 1em;border-radius:0 8px 8px 0}code{background:#f1f2f8;padding:0 4px;border-radius:4px}</style></head><body>${md(R.companionMd || "")}</body></html>`;
}
async function printAnnotated() {
  if (!S.doc) return;
  toast("Preparing pages…", false, 2000);
  for (const pv of S.pv) await renderPage(pv);
  const w = S.pv[0].wrap.offsetWidth;
  document.documentElement.style.setProperty("--print-zoom", String(Math.min(1, 730 / w)));
  setTimeout(() => window.print(), 150);
}

/* ------------------------------------------------------------------ wiring */
function bind() {
  $("#dropzone").onclick = $("#btnOpenBig").onclick = async () => openPaper(await backend.pickPdf());
  $("#btnSettings").onclick = openSettings; $("#connPill").onclick = openSettings;
  $("#closeSettings").onclick = () => ($("#settingsModal").hidden = true);
  $("#settingsModal").addEventListener("mousedown", (e) => { if (e.target.id === "settingsModal") $("#settingsModal").hidden = true; });
  $("#btnSaveSettings").onclick = async () => { readSettingsForm(); saveJSON("neuron7.settings", S.settings); await refreshConnection(false); if (S.connected) { $("#settingsModal").hidden = true; toast("Settings saved."); } };
  $("#btnTest").onclick = async () => { readSettingsForm(); await refreshConnection(false); };
  $("#btnRefresh").onclick = $("#btnTest").onclick;
  $("#sModel").onchange = () => (S.settings.model = $("#sModel").value);
  $$("[data-preset]").forEach((b) => (b.onclick = () => { $("#sBase").value = b.dataset.preset === "ollama" ? "http://localhost:11434" : "http://localhost:1234"; $("#btnTest").click(); }));

  $("#btnTogglePanel").onclick = () => $("#panel").classList.toggle("hidden");
  $("#btnAnalyze").onclick = analyze;
  $("#btnCancel").onclick = () => backend.cancel();

  for (const [id, key] of [["segDensity", "density"], ["segLevel", "level"]]) {
    $$("button", $("#" + id)).forEach((b) => {
      b.classList.toggle("on", b.dataset.v === S.prefs[key]);
      b.onclick = () => { S.prefs[key] = b.dataset.v; saveJSON("neuron7.prefs", S.prefs); $$("button", $("#" + id)).forEach((x) => x.classList.toggle("on", x === b)); };
    });
  }
  for (const id of ["modeSharpie", "modePro", "modeCompanion", "optTldr", "optAcr"]) {
    const saved = S.prefs[id]; if (saved !== undefined) $("#" + id).checked = saved;
    $("#" + id).onchange = () => { S.prefs[id] = $("#" + id).checked; saveJSON("neuron7.prefs", S.prefs); };
  }

  $$("#segStyle button").forEach((b) => (b.onclick = () => { S.style = b.dataset.v; $$("#segStyle button").forEach((x) => x.classList.toggle("on", x === b)); redrawAll(); }));
  $("#chkAnn").onchange = (e) => { S.showAnn = e.target.checked; redrawAll(); };
  $("#chkAcr").onchange = (e) => { S.showAcr = e.target.checked; redrawAll(); };

  const zoom = async (f) => { S.zoom = Math.min(2.2, Math.max(0.5, f === 0 ? 1 : S.zoom * f)); const y = $("#viewer").scrollTop / Math.max(1, $("#pages").scrollHeight); await buildPages(); $("#viewer").scrollTop = y * $("#pages").scrollHeight; };
  $("#zoomIn").onclick = () => zoom(1.15); $("#zoomOut").onclick = () => zoom(1 / 1.15); $("#zoomLbl").onclick = () => zoom(0);
  $("#viewer").addEventListener("scroll", updatePageIndicator, { passive: true });
  $("#viewer").addEventListener("click", (e) => { const t = e.target.closest("[data-id]"); if (t && S.result) select(+t.dataset.id, "page"); });

  $("#btnExport").onclick = (e) => { e.stopPropagation(); $("#exportMenu").hidden = !$("#exportMenu").hidden; };
  document.addEventListener("click", () => ($("#exportMenu").hidden = true));
  $$("#exportMenu button").forEach((b) => (b.onclick = () => exportAs(b.dataset.x)));

  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { S.tab = b.dataset.tab; renderTab(); } });
  $("#tabBody").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { S.removed.add(+del.dataset.del); renderTab(); redrawAll(); return e.stopPropagation(); }
    const chip = e.target.closest(".fchip");
    if (chip) { const c = chip.dataset.cat; S.hiddenCats.has(c) ? S.hiddenCats.delete(c) : S.hiddenCats.add(c); renderTab(); redrawAll(); return; }
    const ann = e.target.closest(".ann");
    if (ann) select(+ann.dataset.id, "list");
  });

  const dz = $("#dropzone");
  backend.onFileDrop(
    (over) => dz.classList.toggle("over", over),
    (path) => openPaper(path),
  );
  let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (S.doc && S.zoom === 1) { buildPages().then(redrawAll); } }, 350); });
}

async function init() {
  bind();
  renderTab(); fillModelSelect(); updateAnalyzeButton();
  $("#emptyHint").textContent = backend.isDesktop ? "" : "Browser preview: using a mock model.";
  refreshConnection();
}
init();
