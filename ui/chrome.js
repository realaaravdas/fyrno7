// Window chrome (custom title bar controls) and sliding indicators.
// Self-contained: loaded as a module, does nothing it cannot support.

/* ---------------------------------------------------------------- sliding indicators */
function slider(container, { line }) {
  container.classList.add("has-slide", line ? "slide-line" : "slide-block");
  const el = document.createElement("i");
  el.className = "slide";
  el.setAttribute("aria-hidden", "true");
  container.prepend(el);
  let placed = false;

  const place = () => {
    const on = container.querySelector("button.on");
    if (!on || container.offsetParent === null || !on.offsetWidth) { el.style.opacity = "0"; placed = false; if (el.classList.contains("ready")) el.classList.remove("ready"); return; }
    el.style.opacity = "1";
    el.style.width = on.offsetWidth + "px";
    el.style.transform = `translateX(${on.offsetLeft}px)`;
    if (!placed) {
      // first placement (or after being hidden): jump, then enable motion
      placed = true;
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("ready")));
    }
  };

  new MutationObserver(place).observe(container, { attributes: true, attributeFilter: ["class", "hidden"], subtree: true, childList: true });
  new ResizeObserver(place).observe(container);
  document.fonts?.ready.then(place);
  place();
}

function initSliders() {
  document.querySelectorAll(".seg").forEach((c) => slider(c, { line: false }));
  document.querySelectorAll(".tabs").forEach((c) => slider(c, { line: true }));
}

/* ---------------------------------------------------------------- window controls */
function initWindowControls() {
  const T = window.__TAURI__;
  const ctl = document.getElementById("winCtl");
  if (!T?.window || !ctl) return;
  const win = T.window.getCurrentWindow();
  document.body.classList.add("native");
  ctl.hidden = false;

  const max = ctl.querySelector('[data-w="max"]');
  const sync = async () => {
    try { max.classList.toggle("is-max", await win.isMaximized()); } catch {}
  };
  ctl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.w === "min") win.minimize();
    else if (b.dataset.w === "max") win.toggleMaximize().then(sync);
    else if (b.dataset.w === "close") win.close();
  });
  try { win.onResized(sync); } catch {}
  sync();
}

initSliders();
initWindowControls();
