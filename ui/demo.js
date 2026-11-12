// Demo backend used by the website (index.html?demo). It serves a fictional sample paper and
// pre-written annotations. No model runs and nothing is uploaded; the progress steps are simulated.
const base = new URL("./demo/", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function demoBackend() {
  let bytes = null, result = null;
  const loadPdf = async () => (bytes ||= new Uint8Array(await (await fetch(new URL("sample-paper.pdf", base))).arrayBuffer()));
  const loadResult = async () => (result ||= await (await fetch(new URL("result.json", base))).json());
  return {
    isDesktop: false,
    demo: true,
    samplePath: "demo:sample-paper.pdf",
    checkConnection: async () => ["Pre-written demo results"],
    readPdf: async () => (await loadPdf()).slice(),
    async inspectPdf() {
      const r = await loadResult();
      return { title: r.title, nPages: r.nPages, chars: 6100, hasText: true, ocrPages: [] };
    },
    async analyze({ options }, onProgress) {
      const r = await loadResult();
      const steps = [
        ["read", "Reading the sample paper (simulated step)"],
        ["tldr", "Writing the TL;DR (simulated step)"],
        ["acronyms", "Decoding acronyms (simulated step)"],
        ["companion", "Drafting the companion document (simulated step)"],
      ];
      for (let i = 0; i < steps.length; i++) {
        onProgress({ stage: steps[i][0], done: i, total: steps.length, message: steps[i][1] });
        await sleep(650);
      }
      onProgress({ stage: "done", done: steps.length, total: steps.length, message: "Finished" });
      return {
        ...r,
        annotations: options.annotate ? r.annotations.map((a) => (options.professional ? a : { ...a, detail: "" })) : [],
        tldr: options.tldr ? r.tldr : null,
        acronyms: options.acronyms ? r.acronyms : [],
        companionMd: options.companion ? r.companionMd : null,
      };
    },
    cancel() {},
    pickPdf: async () => "demo:sample-paper.pdf",
    async ocrPage() { return { text: "", lines: [] }; },
    async setPageTexts() {},
    saveDialog: async (name) => name,
    async saveText(name, content) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([content]));
      a.download = name;
      a.click();
    },
    async exportSummary() { throw new Error("Summary PDF export is available in the desktop app."); },
    onFileDrop() {},
  };
}
