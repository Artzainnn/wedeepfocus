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

// Hero card: the countdown ticks, the blocked site changes, "+ 10 min" adds up.
const hero = document.querySelector("[data-hero]");
if (hero) {
  const timer = hero.querySelector("[data-hero-timer]");
  const site = hero.querySelector("[data-hero-site]");
  const [m, sec] = timer.textContent.split(":").map(Number);
  let endsAt = Date.now() + (m * 60 + sec) * 1000;
  const render = () => {
    timer.textContent = countdown(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
  };
  hero.querySelector("[data-hero-add]").addEventListener("click", () => {
    endsAt = Math.min(endsAt + 10 * 60_000, Date.now() + 10 * 3600_000);
    render();
    timer.classList.remove("is-bumped");
    void timer.offsetWidth;
    timer.classList.add("is-bumped");
  });
  if (!reduceMotion) {
    setInterval(render, 1000);
    const sites = hero.dataset.sites.split(" ");
    let index = 0;
    setInterval(() => {
      site.classList.add("is-leaving");
      setTimeout(() => {
        index = (index + 1) % sites.length;
        site.textContent = sites[index];
        site.classList.remove("is-leaving");
      }, 250);
    }, 2600);
  }
}

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

// "How it works": tick sites, pick a time, add 10 minutes.
for (const pill of document.querySelectorAll("[data-demo-groups] .pill")) {
  pill.addEventListener("click", () => pill.setAttribute("aria-pressed", String(pill.getAttribute("aria-pressed") !== "true")));
}

const timeDemo = document.querySelector("[data-demo-time]");
const goalDemo = document.querySelector("[data-demo-goal]");
if (timeDemo && goalDemo) {
  const presets = [...timeDemo.querySelectorAll("[data-minutes]")];
  const untilText = document.querySelector("[data-until-text]");
  const timer = goalDemo.querySelector("[data-timer]");
  let endsAt = 0;
  const clock = (ms) => new Date(ms).toLocaleTimeString(document.documentElement.lang, { hour: "numeric", minute: "2-digit" });
  const render = () => {
    timer.textContent = countdown(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    untilText.textContent = timeDemo.dataset.until.replace("{time}", clock(endsAt));
  };
  const start = (minutes) => {
    endsAt = Date.now() + minutes * 60_000;
    render();
  };
  for (const button of presets) {
    button.addEventListener("click", () => {
      for (const other of presets) other.setAttribute("aria-checked", String(other === button));
      start(Number(button.dataset.minutes));
    });
  }
  goalDemo.querySelector("[data-add-time]").addEventListener("click", () => {
    endsAt = Math.min(endsAt + 10 * 60_000, Date.now() + 10 * 3600_000);
    render();
    timer.classList.remove("is-bumped");
    void timer.offsetWidth;
    timer.classList.add("is-bumped");
  });
  start(Number(presets.find((b) => b.getAttribute("aria-checked") === "true")?.dataset.minutes ?? 30));
  setInterval(render, 1000);
}

// Payment page: Stripe comes back with ?canceled=1 when the buyer gives up.
const paid = document.querySelector("[data-paid]");
if (paid && new URLSearchParams(location.search).get("canceled") === "1") {
  paid.classList.add("is-canceled");
  for (const node of paid.querySelectorAll("[data-canceled]")) node.textContent = node.dataset.canceled;
}
