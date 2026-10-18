// Review page for product ideas that are not in the extension yet: /concepts/ (English only,
// not indexed, built with `node landing/build.mjs --concepts`). Interactions live in concepts.js.

const WHYS = [
  "I want to finish what I start.",
  "My future self will thank me.",
  "I'm building something I'm proud of.",
  "I want more time for what matters.",
];

// Where each browser keeps its extensions, for the pin step.
const BROWSERS = [
  { key: "chrome", name: "Chrome", where: "Top right of Chrome", pin: "pin" },
  { key: "edge", name: "Edge", where: "Top right of Edge", pin: "eye" },
  { key: "brave", name: "Brave", where: "Top right of Brave", pin: "pin" },
  { key: "arc", name: "Arc", pin: "pin" },
];

export function conceptsPage({ icon, esc, appName }) {
  const logo = `<img src="/assets/icon-32.png" width="18" height="18" alt="">`;
  const review = (body) => `<div class="review"><span class="review-tag">Review only</span>${body}</div>`;
  const extButton = `<button type="button" class="tb-btn tb-ext" data-toolbar-icon hidden aria-label="${esc(appName)}">${logo}<span class="tb-badge" data-badge hidden>30</span></button>`;

  // A short loop that plays by itself: puzzle icon, then the pin (an eye in Edge), then the pinned icon
  // and "Add 10 min" in its popup, the reason to pin it. Nothing in it can be clicked.
  const howTo = `<div class="howto" aria-hidden="true">
            <div class="howto-bar"><span class="howto-omni"></span><span class="howto-new">${logo}</span><span class="howto-puzzle">${icon("puzzle")}</span><span class="howto-avatar"></span></div>
            <div class="howto-menu"><span class="howto-row">${logo}${esc(appName)}<span class="howto-pin"><span class="ico-pin">${icon("pin")}</span><span class="ico-eye">${icon("eye")}</span></span></span></div>
            <div class="howto-pop"><span class="hp-timer"><b class="hp-a">30:00</b><b class="hp-b">40:00</b></span><small>of focus left</small><span class="hp-add">${icon("plus")}Add 10 min</span></div>
            <span class="howto-cursor">${icon("pointer")}</span>
          </div>`;
  const captions = BROWSERS.map((b) =>
    b.key === "arc"
      ? `<p class="howto-caption" data-for="arc">In Arc's sidebar: click the site controls icon ${icon("sliders")} next to the address, then right-click ${esc(appName)} and choose Pin.</p>`
      : `<p class="howto-caption" data-for="${b.key}">${esc(b.where)}: click the puzzle icon ${icon("puzzle")}, then the ${b.pin === "eye" ? `eye ${icon("eye")}` : `pin ${icon("pin")}`}.</p>`,
  ).join("");
  // Arc keeps extensions behind the site controls icon in the address bar, as a grid.
  const howToArc = `<div class="howto howto-arc" aria-hidden="true">
            <div class="ha-url"><span>wedeepfocus.com</span><span class="ha-new">${logo}</span><span class="ha-link">${icon("link")}</span><span class="ha-controls">${icon("sliders")}</span></div>
            <div class="ha-panel"><span class="ha-title">Extensions</span><span class="ha-grid"><i></i><i></i><span class="ha-ours">${logo}<b>${icon("pin")}</b></span><i></i></span></div>
            <div class="howto-pop"><span class="hp-timer"><b class="hp-a">30:00</b><b class="hp-b">40:00</b></span><small>of focus left</small><span class="hp-add">${icon("plus")}Add 10 min</span></div>
            <span class="howto-cursor ha-cursor">${icon("pointer")}</span>
          </div>`;

  // The blocked page, in three layouts (data-layout): why first, timer first, and today's for comparison.
  const blocked = `<div class="bp" data-layout="timer">
          <div class="bp-brand">${logo}${esc(appName)}</div>
          <span class="bp-host">${icon("shield")}instagram.com is blocked<span class="bp-host-time"> · <b data-tick>42:17</b> left</span></span>
          <div class="bp-timer" data-tick>42:17</div>
          <p class="bp-left">of focus left</p>
          <p class="bp-eyebrow">Remember why</p>
          <div class="bp-card"><span class="bubble">${icon("target")}</span><p data-why-out>${esc(WHYS[0])}</p></div>
          <blockquote class="bp-why"><span data-why-out>${esc(WHYS[0])}</span><small>Your why</small></blockquote>
          <p class="bp-quote">The thing you're avoiding is usually the thing that matters.</p>
          <span class="bp-resisted">${icon("sparkles")}You've resisted 3 times today</span>
          <span class="bp-back">Back to work</span>
          <span class="bp-need">I really need it</span>
        </div>`;

  return `<main class="concepts">
  <header class="concepts-intro container">
    <a class="brand" href="/"><img src="/assets/icon-128.png" alt="" width="30" height="30">${esc(appName)}</a>
    <h1>Two changes to review</h1>
    <ol class="concepts-list">
      <li><a href="#pin"><b>Pin step</b> at the end of onboarding</a></li>
      <li><a href="#why"><b>“Why”</b> instead of “long-term goal”</a></li>
    </ol>
    <p class="concepts-legend"><span class="review-tag">Review only</span> = buttons that exist only on this page, to simulate the user. The rest is what users see.</p>
  </header>

  <div class="container">
  <section class="concept" id="pin">
    <div class="concept-head">
      <span class="eyebrow">Change 1</span>
      <h2>Pin step at the end of onboarding</h2>
      <p>Browsers don't let an extension pin itself. This screen shows how, for the user's own browser, and switches by itself once it's pinned.</p>
    </div>
    <div class="chrome" data-pin-demo data-browser="chrome">
      <svg class="pin-arrow" data-pin-arrow aria-hidden="true"><path class="pa-line" data-arrow-line/><path class="pa-head" data-arrow-head/></svg>
      <div class="chrome-top">
        <div class="chrome-tabs" aria-hidden="true"><span class="chrome-tab">${logo}Welcome to ${esc(appName)}</span></div>
        <div class="chrome-toolbar">
          <span class="tb-btn" aria-hidden="true">${icon("arrowLeft")}</span>
          <span class="omnibox" aria-hidden="true">${logo}${esc(appName)}</span>
          ${extButton}
          <span class="tb-btn tb-puzzle" data-puzzle aria-hidden="true">${icon("puzzle")}</span>
          <span class="tb-avatar" aria-hidden="true">M</span>
        </div>
        <span class="chrome-label"><span data-browser-name>Chrome</span>'s own toolbar</span>
      </div>
      <div class="win-body">
        <aside class="arc-side">
          <span class="arc-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="arc-url"><span aria-hidden="true">wedeepfocus.com</span>${extButton}<span class="arc-ico" aria-hidden="true">${icon("link")}</span><span class="arc-ico tb-puzzle" data-puzzle aria-hidden="true">${icon("sliders")}</span></div>
          <span class="arc-tab is-on" aria-hidden="true">${logo}Welcome</span><span class="arc-tab" aria-hidden="true"></span><span class="arc-tab" aria-hidden="true"></span>
          <span class="arc-label">Arc's own sidebar</span>
        </aside>
        <div class="chrome-page">
          <div class="onb-done" data-state="waiting">
            <h3>One last step: pin ${esc(appName)}</h3>
            <p>So a session is always one click away.</p>
            ${howTo}
            ${howToArc}
            ${captions}
            <span class="waiting"><i></i>Waiting for the pin</span>
            <button type="button" class="link-btn" data-skip>Skip</button>
          </div>
          <div class="onb-done" data-state="pinned" hidden>
            <span class="onb-check">${icon("check")}</span>
            <h3>Pinned. You're all set.</h3>
            <ul class="benefits"><li>${icon("clock")}Start a session in one click</li><li>${icon("plus")}Add 10 minutes when you need them</li><li>${icon("target")}See the time left on the icon</li></ul>
            <button type="button" class="btn btn-primary" data-start>Start a 30 min session</button>
          </div>
          <div class="onb-done" data-state="running" hidden>
            <h3>Your session is on</h3>
            <p>The time left shows on the icon. Click it to add 10 minutes.</p>
          </div>
          <div class="onb-done" data-state="skipped" hidden>
            <h3>You're all set</h3>
            <p>The Home page shows one small reminder until it's pinned.</p>
          </div>
        </div>
      </div>
      <div class="mini-popup" data-mini-popup hidden>
        <div class="mini-popup-head">${logo}${esc(appName)}</div>
        <div class="mini-popup-timer" data-popup-timer>30:00</div>
        <p>of focus left</p>
        <button type="button" class="pill pill-add" data-popup-add>${icon("plus")}Add 10 min</button>
      </div>
    </div>
    ${review(`<span class="review-label">Browser</span><div class="segmented" role="tablist">${BROWSERS.map((b) => `<button type="button" role="tab" aria-selected="${b.key === "chrome"}" data-browser-pick="${b.key}">${esc(b.name)}</button>`).join("")}</div><span class="review-detected" data-detected></span><button type="button" class="btn btn-sm" data-simulate-pin>${icon("pin", ' width="16" height="16"')}Simulate: the user pins it</button><button type="button" class="link-btn" data-pin-reset>Start over</button>`)}
  </section>

  <section class="concept" id="why">
    <div class="concept-head">
      <span class="eyebrow">Change 2</span>
      <h2>“Why” instead of “long-term goal”</h2>
      <p>One sentence, no deadline. Pick one on the left: the blocked page shows it on the right.</p>
    </div>
    <div class="split">
      <div class="onb-step" data-why>
        <p class="onb-step-title">Why are you doing this?</p>
        <p class="onb-step-sub">You'll see it when a site is blocked.</p>
        <div class="why-options" role="radiogroup" aria-label="Why are you doing this?">
          ${WHYS.map((why, i) => `<button type="button" class="why-option" role="radio" aria-checked="${i === 0}" data-why="${esc(why)}"><span class="radio"></span>${esc(why)}</button>`).join("")}
          <button type="button" class="why-option" role="radio" aria-checked="false" data-why-own><span class="radio"></span>Write my own</button>
        </div>
        <input type="text" class="why-input" data-why-input maxlength="140" placeholder="I want to…" aria-label="Your why" hidden>
      </div>
      <div class="why-preview">
        ${blocked}
        ${review(`<span class="review-label">Blocked page</span><div class="segmented" role="tablist"><button type="button" role="tab" aria-selected="false" data-layout-pick="why">A. Why first</button><button type="button" role="tab" aria-selected="true" data-layout-pick="timer">B. Timer first (chosen)</button><button type="button" role="tab" aria-selected="false" data-layout-pick="today">Today</button></div>`)}
      </div>
    </div>
  </section>
  </div>
</main>`;
}
