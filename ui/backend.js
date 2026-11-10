// Bridge to the Rust backend (Tauri). A tiny in-browser mock is used when the page is
// opened outside Tauri, which makes the UI easy to preview and test.
import * as pdfjs from "./vendor/pdf.min.mjs";

const T = window.__TAURI__;

function tauriBackend() {
  const { invoke } = T.core;
  const { listen } = T.event;
  return {
    isDesktop: true,
    checkConnection: (baseUrl, apiKey) => invoke("check_connection", { baseUrl, apiKey }),
    readPdf: async (path) => new Uint8Array(await invoke("read_pdf", { path })),
    inspectPdf: (path) => invoke("inspect_pdf", { path }),
    async analyze(req, onProgress) {
      const un = await listen("progress", (e) => onProgress(e.payload));
      try { return await invoke("analyze", { req }); } finally { un(); }
    },
    cancel: () => invoke("cancel_analysis"),
    async pickPdf() {
      const r = await T.dialog.open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      return Array.isArray(r) ? r[0] : r;
    },
    saveDialog: (name, ext, label) => T.dialog.save({ defaultPath: name, filters: [{ name: label, extensions: [ext] }] }),
    ocrPage: (bytes) => invoke("ocr_page", bytes),
    setPageTexts: (path, pages) => invoke("set_page_texts", { path, pages }),
    saveText: (path, content) => invoke("save_text_file", { path, content }),
    exportSummary: (path, data) => invoke("export_summary_pdf", { path, data }),
    onFileDrop(over, drop) {
      T.webview.getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "over" || p.type === "enter") over(true);
        else if (p.type === "leave") over(false);
        else if (p.type === "drop") {
          over(false);
          const pdf = (p.paths || []).find((x) => /\.pdf$/i.test(x));
          if (pdf) drop(pdf);
        }
      });
    },
  };
}

function mockBackend() {
  const files = new Map();
  const texts = new Map(); const ocrDone = new Set();
  async function pagesText(path) {
    if (texts.has(path)) return texts.get(path);
    const doc = await pdfjs.getDocument({ data: files.get(path).slice() }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
    texts.set(path, out);
    return out;
  }
  const register = async (file) => { const path = `mock:${file.name}`; files.set(path, new Uint8Array(await file.arrayBuffer())); return path; };
  return {
    isDesktop: false,
    checkConnection: async () => ["gemma-3-12b-it (mock)"],
    readPdf: async (p) => files.get(p).slice(),
    inspectPdf: async (p) => { const t = await pagesText(p); if (/scan/i.test(p) && !ocrDone.has(p)) return { title: "Scanned paper", nPages: 1, chars: 0, hasText: false, ocrPages: [0] }; return { title: t[0].slice(0, 80), nPages: t.length, chars: t.join("").length, hasText: true, ocrPages: [] }; },
    async ocrPage() { // browser preview only: canned result for the scan test fixture
      await new Promise((r) => setTimeout(r, 1800));
      const L = [["Neural networks learn representations from data.", 0.04, 0.14], ["Stochastic Gradient Descent (SGD) reduces the loss.", 0.04, 0.38], ["We evaluate on English text only.", 0.04, 0.62]];
      return { text: L.map((l) => l[0]).join("\n"), lines: L.map(([text, x, y]) => ({ text, x, y, w: 0.9 * text.length / 52, h: 0.12 })) };
    },
    async setPageTexts(p) { ocrDone.add(p); },
    async analyze({ path, options }, onProgress) {
      if (/scan/i.test(path)) {
        for (let i = 0; i < 6; i++) { onProgress({ done: i, total: 6, message: `Reading pages 1 (${i + 1} of 6)` }); await new Promise((r) => setTimeout(r, 1500)); }
        const A = (id, quote, kind, note) => ({ id, page: 1, quote, kind, note, detail: note, category: "claim", severity: "info" });
        return { title: "Scanned paper", nPages: 1, model: "mock", tldr: null, acronyms: [], companionMd: null, warnings: [], annotations: [A(1, "networks learn representations", "circle", "core idea"), A(2, "Stochastic Gradient Descent (SGD)", "underline", "optimizer"), A(3, "English text only", "doubt", "narrow eval")] };
      }
      const pages = await pagesText(path);
      const kinds = ["underline", "circle", "highlight", "question", "star", "doubt", "define", "link", "highlight", "underline"];
      const cats = ["claim", "term", "result", "question", "insight", "limitation", "definition", "reference", "method", "claim"].map((c) => (c === "term" ? "method" : c));
      const notes = ["key claim", "wait, why?", "nice result", "unclear to me", "main takeaway!", "is this enough data?", "term defined", "see sec. 3", "good setup", "important"];
      const anns = []; let id = 1;
      pages.forEach((t, p) => {
        const w = t.split(" ");
        for (let k = 0; k < 6 && w.length > 60; k++) {
          const s = Math.floor(((k + 0.5) / 6) * (w.length - 12));
          anns.push({ id: id++, page: p + 1, quote: w.slice(s, s + 3 + (k % 3) * 2).join(" "), kind: kinds[(id + k) % 10], note: notes[(id + k) % 10], detail: `Reviewer comment: ${notes[(id + k) % 10]} — worth checking against the evidence presented.`, category: cats[(id + k) % 10], severity: ["info", "minor", "major"][k % 3] });
        }
        onProgress({ done: p + 1, total: pages.length, message: `Mock reading page ${p + 1}` });
      });
      await new Promise((r) => setTimeout(r, 400));
      return {
        title: pages[0].slice(0, 70), nPages: pages.length, model: "mock", annotations: options.annotate ? anns : [],
        tldr: options.tldr ? { oneLiner: "A mock one-line summary of the paper's contribution.", bullets: ["Problem: mock.", "Approach: mock.", "Result: mock."], eli5: "Plain-English mock explanation.", keywords: ["mock", "demo"] } : null,
        acronyms: options.acronyms ? [{ short: "SGD", long: "Stochastic Gradient Descent", source: "paper", count: 4, firstPage: 1, context: "" }, { short: "ML", long: "Machine Learning", source: "inferred", count: 3, firstPage: 1, context: "" }] : [],
        companionMd: options.companion ? "# Companion notes\n\n> **TL;DR** mock\n\n## Overview\n\nMock overview.\n\n- point **one**\n- point two\n" : null,
        warnings: [],
      };
    },
    cancel() {},
    pickPdf: () => new Promise((res) => {
      const i = document.createElement("input"); i.type = "file"; i.accept = "application/pdf";
      i.onchange = async () => res(i.files[0] ? await register(i.files[0]) : null); i.click();
    }),
    async saveDialog(name) { return name; },
    async exportSummary(name) { console.log("mock summary export", name); },
    async saveText(name, content) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content])); a.download = name; a.click(); },
    onFileDrop(over, drop) {
      addEventListener("dragover", (e) => { e.preventDefault(); over(true); });
      addEventListener("dragleave", () => over(false));
      addEventListener("drop", async (e) => { e.preventDefault(); over(false); const f = e.dataTransfer.files[0]; if (f) drop(await register(f)); });
    },
    // exposed for tests
    _register: register,
  };
}

export const backend = T ? tauriBackend() : mockBackend();
if (!T) window.__mock = backend;
