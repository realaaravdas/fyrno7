(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- nav ---------- */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("stuck", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* ---------- paper content ---------- */
  const MARKS = [
    { t: "Stochastic Gradient Descent (SGD)", kind: "circle", ink: "red", note: "SGD: define this", mk: "DEF.", cat: "Definition", c: "#0d9488", sev: "Note", detail: "Abbreviation is introduced once here and reused throughout the paper." },
    { t: "adaptive learning rates cut loss by 14.2%", kind: "hl", ink: "blue", note: "key result!!", cat: "Result", c: "#16a34a", sev: "Major", detail: "Headline quantitative claim. Verify the strength of the baseline in Section 4." },
    { t: "the gain vanishes below ten thousand examples", kind: "squig", ink: "red", note: "why?? sample size?", mk: "???", cat: "Limitation", c: "#d97706", sev: "Major", detail: "The effect disappears on small datasets, which limits practical use." },
    { t: "English text only", kind: "ul", ink: "blue", note: "narrow eval", cat: "Limitation", c: "#db2777", sev: "Minor", detail: "Evaluation is monolingual, so cross-language claims are untested." },
  ];
  const SEGS = ["We study how ", 0, " behaves when training language models with small batches. We find that ", 1, ", but ", 2, ". Experiments cover ", 3, ", so generalisation to other languages is unknown."];
  const FILLER = "Training neural networks remains difficult because the loss surface is non-convex and noisy. Prior work claims momentum alone is sufficient; we find this is not true for transformer models, and propose a scheduler that adapts every epoch.";
  const head = `<h4 class="pt">Adaptive Warmup Improves Small-Batch Training</h4><div class="au">J. Doe, J. Roe · University of Nowhere · 2026</div><div class="ab">Abstract</div>`;
  const tail = `<p>${FILLER}</p><div class="bars"><i></i><i style="width:92%"></i><i style="width:76%"></i><i style="width:88%"></i></div>`;

  const rnd = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  function pathFor(kind, w, h, r) {
    const j = () => (r() - 0.5) * 2;
    if (kind === "circle") {
      const cx = w / 2, cy = h / 2, rx = w / 2 + 6, ry = h / 2 + 4; let d = "";
      for (let i = 0; i <= 44; i++) { const t = -0.4 + (i / 44) * Math.PI * 2.2, k = 1 + (i / 44) * 0.06 + j() * 0.012; d += `${i ? "L" : "M"}${(cx + Math.cos(t) * rx * k).toFixed(1)},${(cy + Math.sin(t) * ry * k).toFixed(1)}`; }
      return d;
    }
    if (kind === "ul") { const y = h - 1; return `M0,${y + j()} Q${w * 0.3},${y + 3} ${w * 0.55},${y - 1} T${w + 2},${y + 1}`; }
    if (kind === "squig") { const y = h + 1; let d = `M0,${y}`; for (let x = 0, up = true; x < w; x += 7, up = !up) d += ` Q${x + 3.5},${y + (up ? -3.5 : 3.5)} ${Math.min(x + 7, w)},${y}`; return d; }
    return "";
  }
  const rel = (el, root) => { let x = 0, y = 0; while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x, y }; };

  function build(host, mode) {
    host.innerHTML = "";
    const paper = document.createElement("div"); paper.className = "paper" + (mode === "doc" ? " docp" : "");
    host.appendChild(paper);
    const items = { marks: [], notes: [], arrows: [], steps: [] };

    if (mode === "doc") {
      paper.innerHTML = `<h4 class="st">Companion notes</h4>
        <blockquote class="st"><b>TL;DR</b> Adaptive step sizes cut validation loss by 14.2%, but only with enough data.</blockquote>
        <h5 class="st">Overview</h5><p class="st">The paper studies how SGD behaves for language models trained with small batches and proposes an adaptive warmup scheduler.</p>
        <h5 class="st">Key results</h5><ul class="st"><li>14.2% lower validation loss than a strong baseline</li><li>91.3% accuracy on the benchmark (+2.1 points)</li></ul>
        <h5 class="st">Critical read</h5><ul class="st"><li><b>Strength:</b> clear, reproducible baseline</li><li><b>Weakness:</b> English-only evaluation</li><li><b>Risk:</b> gain disappears below 10k examples</li></ul>
        <h5 class="st">Questions for the authors</h5><ul class="st"><li>Does the scheduler help multilingual data?</li><li>What is the compute overhead per epoch?</li></ul>
        <h5 class="st">Acronyms</h5><p class="st"><b>SGD</b> Stochastic Gradient Descent · <b>AWS</b> Adaptive Warmup Scheduler</p>`;
      items.steps = $$(".st", paper);
      return { paper, items, mode };
    }

    const body = SEGS.map((s) => {
      if (typeof s === "string") return s;
      const m = MARKS[s];
      return mode === "pro"
        ? `<span class="pm" style="--c:${m.c}" data-i="${s}">${m.t}<span class="bd">${s + 1}</span></span>`
        : `<span class="mk ink-${m.ink}" data-i="${s}">${m.kind === "hl" ? '<span class="hl"></span><span class="st">★</span>' : ""}${m.t}</span>`;
    }).join("");
    paper.innerHTML = `${head}<p>${body}</p>${tail}<svg class="arrows"></svg>`;
    const svg = $("svg.arrows", paper);

    // notes are positioned once layout is known
    const place = () => {
      let lastBottom = 8;
      MARKS.forEach((m, i) => {
        const el = $(`[data-i="${i}"]`, paper); const p = rel(el, paper);
        const top = Math.max(p.y - 10, lastBottom + 6);
        if (mode === "sharpie") {
          const r = rnd(i * 97 + 11);
          const w = el.offsetWidth, h = el.offsetHeight;
          const d = pathFor(m.kind, w, h, r);
          if (d) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "d"); s.setAttribute("viewBox", `0 0 ${w} ${h}`); s.setAttribute("preserveAspectRatio", "none"); s.style.cssText = `left:0;top:${m.kind === "circle" ? 4 : 0}px;width:100%;height:100%`; s.innerHTML = `<path pathLength="1" d="${d}"/>`; el.appendChild(s); }
          const n = document.createElement("div"); n.className = `note ink-${m.ink}`; n.style.top = top + "px";
          n.innerHTML = (m.mk ? `<b>${m.mk}</b>` : "") + m.note; paper.appendChild(n);
          const ex = p.x + w + 10, ey = p.y + h / 2, sx = 538, sy = top + 14;
          const a = document.createElementNS("http://www.w3.org/2000/svg", "path");
          a.setAttribute("pathLength", 1); a.setAttribute("stroke", m.ink === "red" ? "#d11d2b" : "#1d3fbf");
          a.setAttribute("d", `M${sx},${sy} Q${(sx + ex) / 2},${Math.min(sy, ey) - 22} ${ex},${ey}M${ex + 9},${ey - 7}L${ex},${ey}L${ex + 8},${ey + 7}`);
          svg.appendChild(a); items.notes.push(n); items.arrows.push(a); lastBottom = top + (m.mk ? 66 : 48);
        } else {
          const n = document.createElement("div"); n.className = "card-p"; n.style.cssText = `top:${top}px;--c:${m.c}`;
          n.innerHTML = `<div class="h"><i>${i + 1}</i>${m.cat}<u class="${m.sev === "Major" ? "major" : ""}">${m.sev}</u></div>${m.detail}`;
          paper.appendChild(n); items.notes.push(n); lastBottom = top + 92;
          const a = document.createElementNS("http://www.w3.org/2000/svg", "path");
          a.setAttribute("d", `M${p.x + el.offsetWidth + 12},${p.y + 4}L536,${top + 14}`); a.setAttribute("stroke", m.c); a.setAttribute("stroke-opacity", ".45"); a.setAttribute("pathLength", 1);
          svg.appendChild(a); items.arrows.push(a);
        }
        items.marks.push(el);
      });
      paper.style.minHeight = Math.max(paper.offsetHeight, lastBottom + 40) + "px";
    };
    return { paper, items, mode, place };
  }

  /* ---------- fit a fixed-width stage into its container ---------- */
  function fit(host) {
    const box = host.parentElement;
    const apply = () => { const s = Math.min(1, box.clientWidth / 760); host.style.transform = `scale(${s})`; box.style.height = host.offsetHeight * s + "px"; };
    new ResizeObserver(apply).observe(box); apply();
    return apply;
  }

  /* ---------- animation controller ---------- */
  function controller(host, mode) {
    const c = build(host, mode);
    const timers = []; let running = false, visible = false;
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const all = () => [...c.items.marks, ...c.items.notes, ...c.items.arrows, ...c.items.steps];
    const set = (el, on) => (el.classList ? el.classList.toggle("on", on) : el.setAttribute("class", on ? "on" : ""));
    const reset = () => all().forEach((e) => set(e, false));
    const stop = () => { timers.splice(0).forEach(clearTimeout); running = false; };
    const play = () => {
      stop(); reset(); running = true;
      if (reduce) { all().forEach((e) => set(e, true)); return; }
      let t = 500;
      if (mode === "doc") { c.items.steps.forEach((s, i) => later(t + i * 420, () => set(s, true))); t += c.items.steps.length * 420; }
      else c.items.marks.forEach((m, i) => { later(t, () => set(m, true)); later(t + 600, () => { set(c.items.notes[i], true); set(c.items.arrows[i], true); }); t += 1750; });
      later(t + 3600, () => { reset(); later(900, () => visible && play()); });
    };
    const settle = () => { if (c.place) c.place(); fit(host)(); };
    (document.fonts?.ready || Promise.resolve()).then(() => { settle(); if (visible && !running) play(); });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? (!running && play()) : stop(); }, { threshold: 0.25 }).observe(host.parentElement);
    return { play, stop, c };
  }

  /* ---------- hero + mode showcase ---------- */
  controller($("#heroStage"), "sharpie");

  const COPY = {
    sharpie: { h: "Sharpie", p: "Circles, underlines, squiggles and scribbled margin notes in handwriting, as if you went at a printout with a marker.", li: ["Circle, underline, highlight, squiggle, star and boxed-definition marks", "Handwritten notes with hand-drawn arrows into the margin", "Drawn on top of the page, so your original PDF is never modified"] },
    pro: { h: "Professional", p: "Clean, colour-coded highlights with numbered review comments, categories and severity, ready to share with a team.", li: ["Claim, method, result, limitation and question categories", "Severity levels flag what deserves real attention", "Filter by category and delete anything you disagree with"] },
    doc: { h: "Companion document", p: "A separate notes document that lives beside the paper: overview, contributions, critique and open questions.", li: ["Page-by-page digest and a full annotation index", "Strengths, weaknesses and questions for the authors", "Export to Markdown or HTML, glossary included"] },
  };
  let current = null;
  function showMode(m) {
    $$("#modeTabs button").forEach((b) => { b.classList.toggle("on", b.dataset.m === m); b.setAttribute("aria-selected", b.dataset.m === m); });
    const c = COPY[m]; $("#modeCopy").innerHTML = `<h3>${c.h}</h3><p>${c.p}</p><ul>${c.li.map((x) => `<li>${x}</li>`).join("")}</ul>`;
    if (current) current.stop();
    const old = $("#modeStage"); const fresh = old.cloneNode(false); fresh.removeAttribute("style"); old.replaceWith(fresh); // drop old observers/listeners
    current = controller(fresh, m);
  }
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showMode(b.dataset.m); });
  showMode("sharpie");

  /* ---------- neural network canvas ---------- */
  (function net() {
    const cv = $("#net"), ctx = cv.getContext("2d"); let W, H, nodes = [], mouse = { x: -999, y: -999 }, on = true, raf;
    const col = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c7cff";
    function size() {
      const dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(80, Math.round((W * H) / 15000)); nodes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: 1.2 + Math.random() * 1.8, p: Math.random() * 6 }));
    }
    function frame(t) {
      ctx.clearRect(0, 0, W, H); const c = col();
      for (const a of nodes) {
        a.x += a.vx; a.y += a.vy; if (a.x < 0 || a.x > W) a.vx *= -1; if (a.y < 0 || a.y > H) a.vy *= -1;
        const dx = a.x - mouse.x, dy = a.y - mouse.y, d = Math.hypot(dx, dy); if (d < 120) { a.x += (dx / d) * 0.6; a.y += (dy / d) * 0.6; }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 150) { ctx.globalAlpha = (1 - d / 150) * 0.35; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          const s = ((t / 1800 + i * 0.37 + j * 0.11) % 1); if (d < 110 && (i + j) % 5 === 0) { ctx.globalAlpha = 0.9 * (1 - d / 150); ctx.fillStyle = "#c084fc"; ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, 1.8, 0, 7); ctx.fill(); } }
      }
      for (const a of nodes) { ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t / 900 + a.p); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; if (on && !reduce) raf = requestAnimationFrame(frame);
    }
    size(); frame(0);
    addEventListener("resize", () => { size(); if (reduce) frame(0); });
    $(".hero").addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    new IntersectionObserver(([e]) => { on = e.isIntersecting; cancelAnimationFrame(raf); if (on && !reduce) raf = requestAnimationFrame(frame); }).observe(cv);
  })();

  /* ---------- reveal, typing, counters ---------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.18 });
  $$(".reveal").forEach((el, i) => { el.style.transitionDelay = (i % 3) * 90 + "ms"; io.observe(el); });

  const typed = $("#typed"), TXT = "Adaptive learning-rate schedules cut validation loss by 14.2%, but only when the dataset is large enough.";
  let tTimer, tVisible = false;
  function type() { clearTimeout(tTimer); let i = 0; typed.textContent = ""; if (reduce) { typed.textContent = TXT; return; } const step = () => { typed.textContent = TXT.slice(0, ++i); tTimer = setTimeout(i < TXT.length ? step : () => tVisible && type(), i < TXT.length ? 28 : 4200); }; step(); }
  new IntersectionObserver(([e]) => { tVisible = e.isIntersecting; if (tVisible) type(); else clearTimeout(tTimer); }, { threshold: 0.4 }).observe(typed);

  $$("[data-count]").forEach((el) => { const to = +el.dataset.count; if (!to || reduce) return; let n = 0; const id = setInterval(() => { el.textContent = ++n; if (n >= to) clearInterval(id); }, 260); });

  /* ---------- detect OS for the primary download button ---------- */
  (function () {
    const ua = navigator.userAgent, R = "https://github.com/realaaravdas/neuron7/releases/latest/download/";
    const os = /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? "mac" : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? "linux" : "windows";
    const map = { windows: ["Windows", "neuron7-windows-x64-setup.exe"], mac: ["macOS", "neuron7-macos-universal.dmg"], linux: ["Linux", "neuron7-linux-x86_64.AppImage"] };
    const p = $("#dlPrimary"); if (!p) return;
    p.href = R + map[os][1]; $("#dlLabel").textContent = "Download for " + map[os][0];
    $(`.os[data-os="${os}"]`)?.classList.add("me");
    const hero = $(".cta .btn.primary"); if (hero) hero.lastChild.textContent = "Download for " + map[os][0];
  })();

  /* ---------- install tabs + copy ---------- */
  $("#instTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $$("#instTabs button").forEach((x) => x.classList.toggle("on", x === b)); $$(".inst-pane").forEach((p) => p.classList.toggle("on", p.dataset.i === b.dataset.i)); });
  $$(".copy").forEach((b) => b.addEventListener("click", async () => {
    const text = b.dataset.copy;
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    const old = b.textContent; b.textContent = "Copied"; b.classList.add("done"); setTimeout(() => { b.textContent = old; b.classList.remove("done"); }, 1400);
  }));

  /* ---------- faq: one open at a time ---------- */
  $("#faqList").addEventListener("toggle", (e) => { if (e.target.open) $$("#faqList details").forEach((d) => d !== e.target && (d.open = false)); }, true);
})();
