// /concepts/ review page. No data leaves the page.
// Wrapped in a function: site.js shares the page's global scope.
(() => {
  const pad2 = (n) => String(n).padStart(2, "0");
  const clock = (seconds) => `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;
  const bump = (node) => {
    node.classList.remove("is-bumped");
    void node.offsetWidth;
    node.classList.add("is-bumped");
  };

  // Blocked page timers tick down like the real one.
  const ticks = [...document.querySelectorAll("[data-tick]")];
  const blockedEnd = Date.now() + (42 * 60 + 17) * 1000;
  setInterval(() => {
    const left = Math.max(0, Math.round((blockedEnd - Date.now()) / 1000));
    for (const node of ticks) node.textContent = clock(left);
  }, 1000);

  // The visitor's browser, the way the extension would tell them apart. Arc adds its palette as
  // CSS variables to every page; Brave answers navigator.brave; Edge says so in its brands.
  async function detectBrowser() {
    if (getComputedStyle(document.documentElement).getPropertyValue("--arc-palette-title")) return "arc";
    if (navigator.brave && (await navigator.brave.isBrave?.())) return "brave";
    const brands = navigator.userAgentData?.brands?.map((b) => b.brand).join(" ") ?? "";
    if (/Edge/i.test(brands) || /Edg\//.test(navigator.userAgent)) return "edge";
    return "chrome";
  }

  /* Change 1: pin step */
  const demo = document.querySelector("[data-pin-demo]");
  if (demo) {
    const arrow = demo.querySelector("[data-pin-arrow]");
    const page = demo.querySelector(".chrome-page");
    const states = [...demo.querySelectorAll("[data-state]")];
    const icons = [...demo.querySelectorAll("[data-toolbar-icon]")];
    const popup = demo.querySelector("[data-mini-popup]");
    const popupTimer = demo.querySelector("[data-popup-timer]");
    const picks = [...document.querySelectorAll("[data-browser-pick]")];
    const names = { chrome: "Chrome", edge: "Edge", brave: "Brave", arc: "Arc" };
    let state = "waiting";
    let sessionEnd = 0;

    const visible = (selector) => [...demo.querySelectorAll(selector)].find((node) => node.offsetParent !== null);
    // Draw the arrow from the page to the extensions icon, wherever this browser puts it: from below
    // for a toolbar above the page, from the right for Arc's sidebar on the left.
    const line = arrow.querySelector("[data-arrow-line]");
    const head = arrow.querySelector("[data-arrow-head]");
    const aim = () => {
      const puzzle = visible("[data-puzzle]");
      if (state !== "waiting" || !puzzle) return;
      const box = demo.getBoundingClientRect();
      const p = puzzle.getBoundingClientRect();
      const cx = p.left - box.left + p.width / 2;
      const cy = p.top - box.top + p.height / 2;
      const gap = p.width / 2 + 12; // stop just outside the pulsing ring
      let start, tip, bend;
      if (p.right <= page.getBoundingClientRect().left + 1) {
        tip = { x: cx + gap, y: cy };
        start = { x: Math.min(tip.x + 150, box.width - 16), y: cy + 100 };
        bend = { x: start.x, y: tip.y };
      } else {
        tip = { x: cx, y: cy + gap };
        start = { x: Math.max(cx - 140, 16), y: tip.y + 90 };
        bend = { x: tip.x, y: start.y };
      }
      line.setAttribute("d", `M${start.x} ${start.y} Q${bend.x} ${bend.y} ${tip.x} ${tip.y}`);
      const angle = Math.atan2(tip.y - bend.y, tip.x - bend.x);
      const wing = (side) => `${tip.x - 14 * Math.cos(angle + side)} ${tip.y - 14 * Math.sin(angle + side)}`;
      head.setAttribute("d", `M${wing(-0.55)} L${tip.x} ${tip.y} L${wing(0.55)}`);
    };
    const setState = (name) => {
      state = name;
      for (const node of states) node.hidden = node.dataset.state !== name;
      arrow.toggleAttribute("hidden", name !== "waiting"); // an SVG element has no .hidden property
      for (const node of demo.querySelectorAll("[data-puzzle]")) node.classList.toggle("is-hinted", name === "waiting");
      for (const icon of icons) {
        icon.hidden = !["pinned", "running"].includes(name);
        icon.classList.toggle("is-hinted", name === "running");
        icon.querySelector("[data-badge]").hidden = name !== "running";
      }
      popup.hidden = true;
      requestAnimationFrame(aim);
    };
    const setBrowser = (key) => {
      demo.dataset.browser = key;
      for (const pick of picks) pick.setAttribute("aria-selected", String(pick.dataset.browserPick === key));
      for (const node of demo.querySelectorAll("[data-browser-name]")) node.textContent = names[key];
      popup.hidden = true;
      requestAnimationFrame(aim);
    };
    const renderSession = () => {
      const left = Math.max(0, Math.round((sessionEnd - Date.now()) / 1000));
      popupTimer.textContent = clock(left);
      for (const icon of icons) icon.querySelector("[data-badge]").textContent = String(Math.ceil(left / 60));
    };
    // The popup opens under the icon that was clicked.
    const openPopup = (icon) => {
      const r = icon.getBoundingClientRect();
      const box = demo.getBoundingClientRect();
      const width = 230;
      popup.style.top = `${r.bottom - box.top + 8}px`;
      popup.style.left = `${Math.min(Math.max(8, r.left - box.left + r.width / 2 - width / 2), box.width - width - 8)}px`;
      popup.hidden = false;
      for (const node of icons) node.classList.remove("is-hinted");
    };

    for (const icon of icons) {
      icon.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!popup.hidden) {
          popup.hidden = true;
          return;
        }
        if (state === "pinned") start();
        openPopup(icon);
      });
    }
    const start = () => {
      sessionEnd = Date.now() + 30 * 60 * 1000;
      setState("running");
      renderSession();
    };
    demo.querySelector("[data-start]").addEventListener("click", start);
    demo.querySelector("[data-popup-add]").addEventListener("click", (event) => {
      event.stopPropagation();
      sessionEnd += 10 * 60 * 1000;
      renderSession();
      bump(popupTimer);
    });
    popup.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", () => {
      popup.hidden = true;
    });
    setInterval(() => {
      if (state === "running") renderSession();
    }, 1000);
    demo.querySelector("[data-skip]").addEventListener("click", () => setState("skipped"));
    document.querySelector("[data-simulate-pin]").addEventListener("click", (event) => {
      event.stopPropagation();
      setState("pinned");
    });
    document.querySelector("[data-pin-reset]").addEventListener("click", () => setState("waiting"));
    let picked = false;
    for (const pick of picks) {
      pick.addEventListener("click", () => {
        picked = true;
        setBrowser(pick.dataset.browserPick);
      });
    }
    new ResizeObserver(() => aim()).observe(demo);

    setState("waiting");
    const detect = async () => {
      const key = await detectBrowser();
      if (!picked) setBrowser(key);
      document.querySelector("[data-detected]").textContent = `Detected: ${names[key]}`;
    };
    detect();
    setTimeout(detect, 1500); // Arc adds its variables a moment after the page loads
  }

  /* Change 2: why. Pick a sentence or write your own; the blocked page follows. */
  const why = document.querySelector("[data-why]");
  if (why) {
    const options = [...why.querySelectorAll(".why-option")];
    const input = why.querySelector("[data-why-input]");
    const outs = [...document.querySelectorAll("[data-why-out]")];
    const quote = document.querySelector(".bp-why");
    const show = (text, animate = true) => {
      for (const out of outs) out.textContent = text || "Write your sentence";
      if (animate) bump(quote);
    };
    for (const option of options) {
      option.addEventListener("click", () => {
        for (const other of options) other.setAttribute("aria-checked", String(other === option));
        const own = "whyOwn" in option.dataset;
        input.hidden = !own;
        if (own) input.focus();
        show(own ? input.value.trim() : option.dataset.why);
      });
    }
    input.addEventListener("input", () => show(input.value.trim(), false));

    const bp = document.querySelector(".bp[data-layout]");
    const layouts = [...document.querySelectorAll("[data-layout-pick]")];
    for (const pick of layouts) {
      pick.addEventListener("click", () => {
        bp.dataset.layout = pick.dataset.layoutPick;
        for (const other of layouts) other.setAttribute("aria-selected", String(other === pick));
      });
    }
  }
})();
