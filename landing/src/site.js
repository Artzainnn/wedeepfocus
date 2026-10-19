// Small progressive enhancements: nav border on scroll, reveal on scroll, demos.
document.documentElement.classList.remove("no-js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const nav = document.querySelector(".nav");
if (nav) {
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

const revealed = document.querySelectorAll(".reveal");
if (reduceMotion || !("IntersectionObserver" in window)) {
  revealed.forEach((node) => node.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  revealed.forEach((node) => observer.observe(node));
}

// The unlock sentence types itself, then starts over.
const sentence = document.querySelector("[data-sentence]");
if (sentence) {
  const text = sentence.dataset.sentence;
  const done = sentence.querySelector(".done");
  const rest = sentence.querySelector(".rest");
  const bar = document.querySelector("[data-typing-bar]");
  const count = document.querySelector("[data-typing-count]");
  const render = (typed) => {
    done.textContent = text.slice(0, typed);
    rest.textContent = text.slice(typed);
    if (bar) bar.style.width = `${Math.round((typed / text.length) * 100)}%`;
    if (count) count.textContent = `${typed} / ${text.length}`;
  };
  if (reduceMotion) {
    render(Math.round(text.length * 0.4));
  } else {
    let typed = 0;
    const tick = () => {
      typed += 1;
      render(typed);
      const pause = typed >= text.length ? 2600 : text[typed - 1] === " " ? 70 : 45 + Math.random() * 60;
      if (typed >= text.length) typed = 0;
      setTimeout(tick, pause);
    };
    render(0);
    setTimeout(tick, 900);
  }
}

const pad2 = (n) => String(n).padStart(2, "0");
const countdown = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(seconds % 60)}` : `${pad2(m)}:${pad2(seconds % 60)}`;
};

// Two-option switches (Now / Schedule, and the paid variant's Type / Pay).
for (const box of document.querySelectorAll("[data-switch]")) {
  const tabs = [...box.querySelectorAll("[data-tab]")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const other of tabs) other.setAttribute("aria-selected", String(other === tab));
      for (const panel of box.querySelectorAll(":scope > [data-panel]")) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    });
  }
}
for (const day of document.querySelectorAll(".day")) {
  day.addEventListener("click", () => day.setAttribute("aria-pressed", String(day.getAttribute("aria-pressed") !== "true")));
}

// "How it works": tick sites, pick a time.
for (const pill of document.querySelectorAll("[data-demo-groups] .pill")) {
  pill.addEventListener("click", () => pill.setAttribute("aria-pressed", String(pill.getAttribute("aria-pressed") !== "true")));
}

// Step 2: picking a duration shows when the block would end.
const timeDemo = document.querySelector("[data-demo-time]");
if (timeDemo) {
  const presets = [...timeDemo.querySelectorAll("[data-minutes]")];
  const untilText = document.querySelector("[data-until-text]");
  const clock = (ms) => new Date(ms).toLocaleTimeString(document.documentElement.lang, { hour: "numeric", minute: "2-digit" });
  let minutes = Number(presets.find((b) => b.getAttribute("aria-checked") === "true")?.dataset.minutes ?? 30);
  const render = () => {
    untilText.textContent = timeDemo.dataset.until.replace("{time}", clock(Date.now() + minutes * 60_000));
  };
  for (const button of presets) {
    button.addEventListener("click", () => {
      for (const other of presets) other.setAttribute("aria-checked", String(other === button));
      minutes = Number(button.dataset.minutes);
      render();
    });
  }
  render();
  setInterval(render, 30_000);
}

// Payment page: Stripe comes back with ?canceled=1 when the buyer gives up.
const paid = document.querySelector("[data-paid]");
if (paid && new URLSearchParams(location.search).get("canceled") === "1") {
  paid.classList.add("is-canceled");
  for (const node of paid.querySelectorAll("[data-canceled]")) node.textContent = node.dataset.canceled;
}

/* ---------- Hero ---------- */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bump = (node) => {
  node.classList.remove("is-bumped");
  void node.offsetWidth;
  node.classList.add("is-bumped");
};

// DataFast goals sent by the demo, each at most once per page view (links and buttons that only
// need a click count carry data-fast-goal in the HTML). Nothing is sent without DataFast.
const sentGoals = new Set();
const demoGoal = (name, props) => {
  const key = `${name} ${JSON.stringify(props ?? {})}`;
  if (sentGoals.has(key)) return;
  sentGoals.add(key);
  window.datafast?.(name, props);
};

// Every [data-countdown] ticks; "+ 15 min" in the same [data-timer-scope] adds time.
const countdowns = new Map();
const renderCountdown = (node) => {
  node.textContent = countdown(Math.max(0, Math.round((countdowns.get(node) - Date.now()) / 1000)));
};
for (const node of document.querySelectorAll("[data-countdown]")) {
  const [m, s] = node.textContent.split(":").map(Number);
  countdowns.set(node, Date.now() + (m * 60 + s) * 1000);
}
if (countdowns.size) setInterval(() => countdowns.forEach((_, node) => renderCountdown(node)), 1000);
for (const button of document.querySelectorAll("[data-add]")) {
  button.addEventListener("click", () => {
    const node = button.closest("[data-timer-scope]").querySelector("[data-countdown]");
    countdowns.set(node, Math.min(countdowns.get(node) + 15 * 60_000, Date.now() + 10 * 3600_000));
    renderCountdown(node);
    bump(node);
    demoGoal("demo_add_time");
  });
}

async function showSite(win, domain) {
  win.classList.add("is-switching");
  await sleep(250);
  for (const node of win.querySelectorAll("[data-site]")) node.textContent = domain;
  win.classList.remove("is-switching");
}
async function rotateWord(node, text) {
  node.classList.add("is-leaving");
  await sleep(250);
  node.textContent = text;
  node.classList.remove("is-leaving");
}

// The browser plays on its own (feed, then the session starts, next site) until the visitor
// touches it; then the switch and the blocked page are theirs.
for (const win of document.querySelectorAll("[data-swap]")) {
  const sites = win.dataset.sites.split(" ");
  const names = win.dataset.names.split("|");
  const rotator = document.querySelector("[data-rotator]");
  const toggle = document.querySelector("[data-toggle]");
  // "+ 15 min" beside the switch, shown while a session runs, as in the extension's popup.
  const add = win.closest("[data-timer-scope]")?.querySelector("[data-add]");
  let manual = false;
  const setBlocked = (on) => {
    win.classList.toggle("is-blocked", on);
    toggle?.setAttribute("aria-checked", String(on));
    if (add) add.hidden = !on;
    win.dispatchEvent(new CustomEvent("session", { detail: on }));
  };
  const takeOver = () => {
    manual = true;
  };
  win.addEventListener("pointerdown", takeOver);
  win.addEventListener("focusin", takeOver);
  add?.addEventListener("click", takeOver);
  win.addEventListener("session-end", () => setBlocked(false));
  toggle?.addEventListener("click", () => {
    manual = true;
    setBlocked(!win.classList.contains("is-blocked"));
  });
  if (reduceMotion) {
    setBlocked(true);
    continue;
  }
  (async () => {
    for (let i = 0; ; i = (i + 1) % sites.length) {
      if (i) {
        await Promise.all([manual ? null : showSite(win, sites[i]), rotator ? rotateWord(rotator, names[i]) : null]);
      }
      if (!manual) setBlocked(false);
      await sleep(1800);
      if (!manual) setBlocked(true);
      await sleep(3600);
    }
  })();
}

// The blocked page's steps, as in the extension: "I really need it", one question, then the
// sentence typed by hand (accents optional, no pasting, a wrong letter is taken back).
const normalize = (text) =>
  text
    .normalize("NFD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^ /, "");
for (const page of document.querySelectorAll("[data-blocked]")) {
  const win = page.closest("[data-swap]");
  const views = [...page.querySelectorAll("[data-view]")];
  const input = page.querySelector("[data-type-input]");
  const phrase = page.querySelector("[data-phrase]");
  const sentence = phrase.dataset.phrase;
  const target = normalize(sentence).trimEnd();
  const done = phrase.querySelector(".phrase-done");
  const rest = phrase.querySelector(".phrase-rest");
  const bar = page.querySelector("[data-type-bar]");
  const count = page.querySelector("[data-type-count]");
  const error = page.querySelector("[data-type-error]");
  const end = page.querySelector("[data-type-end]");
  let typed = "";

  const render = () => {
    const n = Math.min(normalize(typed).length, target.length);
    done.textContent = sentence.slice(0, n);
    rest.textContent = sentence.slice(n);
    bar.style.width = `${Math.round((n / target.length) * 100)}%`;
    count.textContent = `${n} / ${target.length}`;
    end.disabled = normalize(typed).trimEnd() !== target;
  };
  const warn = (message) => {
    error.textContent = message;
    input.classList.remove("is-wrong");
    void input.offsetWidth;
    input.classList.add("is-wrong");
  };
  const show = (name, focus = true) => {
    for (const view of views) view.hidden = view.dataset.view !== name;
    if (name === "type") {
      typed = input.value = "";
      error.textContent = "";
      render();
    }
    if (!focus) return;
    const first = name === "type" ? input : page.querySelector(`[data-view="${name}"] [tabindex="-1"], [data-view="${name}"] button`);
    first?.focus({ preventScroll: true });
  };

  const tried = { done: "back_to_work", question: "really_need" };
  for (const button of page.querySelectorAll("[data-go]")) {
    button.addEventListener("click", () => {
      if (tried[button.dataset.go]) demoGoal("try_demo", { action: tried[button.dataset.go] });
      show(button.dataset.go);
    });
  }
  win?.addEventListener("session", () => show("main", false));
  const refusePaste = (event) => {
    event.preventDefault();
    warn(input.dataset.paste);
  };
  input.addEventListener("paste", refusePaste);
  input.addEventListener("drop", refusePaste);
  input.addEventListener("beforeinput", (event) => {
    if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") refusePaste(event);
  });
  const fits = (text) => {
    const value = normalize(text);
    return target.startsWith(value) || value.trimEnd() === target;
  };
  input.addEventListener("input", () => {
    if (fits(input.value)) {
      typed = input.value;
      error.textContent = "";
    } else {
      // Keep what was right, drop the wrong letter and anything after it.
      let keep = input.value.length - 1;
      while (keep > 0 && !fits(input.value.slice(0, keep))) keep -= 1;
      typed = input.value = input.value.slice(0, keep);
      warn(input.dataset.typo);
    }
    render();
  });
  end.addEventListener("click", () => {
    if (end.disabled) return;
    demoGoal("try_demo", { action: "typed" });
    win?.dispatchEvent(new CustomEvent("session-end"));
  });
}

// GitHub stars in the nav: the build wrote the count, /api/stars keeps it fresh.
const stars = document.querySelector("[data-stars-count]");
if (stars) {
  fetch("/api/stars")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Number.isInteger(data.stars) && data.stars > 0) stars.textContent = data.stars.toLocaleString(document.documentElement.lang);
    })
    .catch(() => {});
}

/* ---------- Feedback page ---------- */
// The form posts straight to Web3Forms, which emails the developer. ?from=uninstall (opened by
// Chrome when the extension is removed) asks why, with a few one-tap reasons.
const feedback = document.querySelector("[data-feedback]");
const feedbackForm = feedback?.querySelector("[data-feedback-form]");
if (feedback && feedbackForm) {
  const params = new URLSearchParams(location.search);
  const from = params.get("from") === "uninstall" ? "uninstall" : params.get("from") === "menu" ? "menu" : "site";
  const reasons = [...feedbackForm.querySelectorAll("[data-reason]")];
  const message = feedbackForm.querySelector("[data-message]");
  const email = feedbackForm.querySelector("[data-email]");
  const error = feedbackForm.querySelector("[data-error]");
  const send = feedbackForm.querySelector("[data-send]");
  const done = feedback.querySelector("[data-done]");

  if (from === "uninstall") {
    for (const node of feedback.querySelectorAll("[data-leave]")) node.textContent = node.dataset.leave;
    feedbackForm.querySelector("[data-reasons]").hidden = false;
  }
  for (const reason of reasons) {
    reason.addEventListener("click", () => {
      reason.setAttribute("aria-pressed", String(reason.getAttribute("aria-pressed") !== "true"));
      error.hidden = true;
    });
  }
  message.addEventListener("input", () => {
    error.hidden = true;
  });

  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const picked = reasons.filter((reason) => reason.getAttribute("aria-pressed") === "true").map((reason) => reason.dataset.reason);
    const text = message.value.trim();
    if (!text && !picked.length) {
      error.textContent = feedback.dataset.empty;
      error.hidden = false;
      message.focus();
      return;
    }
    const label = send.textContent;
    send.disabled = true;
    send.textContent = feedback.dataset.sending;
    error.hidden = true;
    try {
      const version = (params.get("v") ?? "").slice(0, 20);
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: feedback.dataset.key,
          subject: `${feedback.dataset.app} ${from === "uninstall" ? "uninstall" : "feedback"}${version ? ` (v${version})` : ""}`,
          from_name: feedback.dataset.app,
          message: text || "(no message)",
          reasons: picked.join(", "),
          email: email.value.trim(),
          from,
          version,
          language: document.documentElement.lang,
          botcheck: "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true) throw new Error(data.message || `HTTP ${res.status}`);
      feedbackForm.hidden = true;
      done.hidden = false;
      done.querySelector("a")?.focus();
    } catch {
      error.textContent = feedback.dataset.failed;
      error.hidden = false;
    } finally {
      send.disabled = false;
      send.textContent = label;
    }
  });
}

// Launch film: opens full screen from the hero, with sound. Leaving full screen, Escape or the
// close button stop it.
const film = document.querySelector("[data-film]");
const filmOpen = document.querySelector("[data-film-open]");
if (film && filmOpen) {
  const video = film.querySelector("video");
  const close = () => {
    video.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (film.open) film.close();
  };
  filmOpen.addEventListener("click", () => {
    film.showModal();
    video.currentTime = 0;
    video.play().catch(() => {});
    // Phones: turn to landscape where the browser allows it (Android), native player on iPhone.
    if (video.requestFullscreen) {
      video.requestFullscreen().then(() => screen.orientation?.lock?.("landscape")).catch(() => {});
    } else video.webkitEnterFullscreen?.();
  });
  film.querySelector("[data-film-close]").addEventListener("click", close);
  film.addEventListener("close", () => video.pause());
  film.addEventListener("click", (event) => {
    if (event.target === film) close();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && film.open) close();
  });
  video.addEventListener("webkitendfullscreen", close);
}
