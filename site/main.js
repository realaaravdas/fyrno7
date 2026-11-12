(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* mobile menu */
  const menuBtn = $("#menuBtn"), nav = $("#nav");
  if (menuBtn && nav) {
    const set = (open) => { nav.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", String(open)); menuBtn.textContent = open ? "Close" : "Menu"; };
    menuBtn.addEventListener("click", () => set(!nav.classList.contains("open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { set(false); menuBtn.focus(); } });
  }

  /* primary download button follows the visitor's system */
  const primary = $("#dlPrimary");
  if (primary) {
    const base = "https://github.com/realaaravdas/fyrno7/releases/latest/download/";
    const ua = navigator.userAgent;
    const os = /Android|iPhone|iPad/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "mac" : /Linux|X11/i.test(ua) ? "linux" : "windows";
    const pick = { windows: ["Windows", "fyrno7-windows-x64-setup.exe"], mac: ["macOS", "fyrno7-macos-universal.dmg"], linux: ["Linux", "fyrno7-linux-x86_64.AppImage"] }[os];
    primary.href = base + pick[1];
    $("#dlLabel").textContent = "Download for " + pick[0];
    const rec = $(`tr[data-os="${os}"] .rec`); if (rec) rec.hidden = false;
  }

  /* demo: scale the fixed-size interface to the column and let the buttons drive it */
  const box = $("#demoBox"), frame = $("#demoFrame");
  if (box && frame) {
    const W = 1280, H = 800;
    const fit = () => { const s = Math.min(1, box.clientWidth / W); frame.style.transform = `scale(${s})`; box.style.height = Math.round(H * s) + "px"; };
    new ResizeObserver(fit).observe(box); fit();
    const send = (action, value) => frame.contentWindow && frame.contentWindow.postMessage({ source: "fyrno7-site", action, value }, location.origin);
    $$("[data-demo]").forEach((b) => b.addEventListener("click", () => {
      const [action, value] = b.dataset.demo.split(":");
      send(action, value);
      $$("[data-demo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
  }

  /* copy buttons */
  $$(".copy-btn").forEach((b) => b.addEventListener("click", async () => {
    const text = b.dataset.copy, old = b.textContent;
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    b.textContent = "Copied"; setTimeout(() => (b.textContent = old), 1500);
  }));

  /* faq and first launch: opening one closes the others in the same list */
  $$("[data-exclusive]").forEach((list) => list.addEventListener("toggle", (e) => {
    if (e.target.open) $$("details", list).forEach((d) => d !== e.target && (d.open = false));
  }, true));
})();
