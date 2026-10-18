// Original stroke icons (24 x 24 grid, 2 px stroke, currentColor), built with DOM APIs.

const SVG_NS = "http://www.w3.org/2000/svg";

const path = (d) => ["path", { d }];
const circle = (cx, cy, r) => ["circle", { cx, cy, r }];
const dot = (cx, cy) => ["circle", { cx, cy, r: 1.1, fill: "currentColor", stroke: "none" }];
const rect = (x, y, width, height, rx) => ["rect", { x, y, width, height, rx }];

const ICONS = {
  users: [
    circle(9, 8, 3.5),
    path("M2.5 20a6.5 6.5 0 0 1 13 0"),
    path("M15.5 4.7a3.5 3.5 0 0 1 0 6.6"),
    path("M18 14.3a6.5 6.5 0 0 1 3.5 5.7"),
  ],
  play: [circle(12, 12, 9), path("M10 8.6v6.8l5.4-3.4z")],
  mail: [rect(3, 5, 18, 14, 2.5), path("M3.8 7.5 12 13l8.2-5.5")],
  news: [
    path("M4 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"),
    path("M17 9h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1"),
    path("M7.5 8.5h6"),
    path("M7.5 12h6"),
    path("M7.5 15.5h4"),
  ],
  cart: [path("M2.5 4.5H5l2.4 10.5h10.3l2.3-7.5H5.7"), circle(9, 19, 1.5), circle(16.5, 19, 1.5)],
  chat: [
    path("M6 4h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7l-4.5 3.5V17H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"),
    path("M8 9h8"),
    path("M8 12.5h5"),
  ],
  game: [rect(2.5, 7, 19, 11, 5.5), path("M7.5 10.5v4"), path("M5.5 12.5h4"), dot(15.5, 11.2), dot(17.8, 13.8)],
  music: [path("M9 18V5.5l11-2V16"), circle(6.5, 18, 2.5), circle(17.5, 16, 2.5)],
  briefcase: [
    rect(3, 7, 18, 13, 2.5),
    path("M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"),
    path("M3 12.5h18"),
  ],
  heart: [path("M12 20.5L4.4 13a4.6 4.6 0 0 1 6.5-6.5L12 7.6l1.1-1.1a4.6 4.6 0 0 1 6.5 6.5z")],
  star: [path("M12 3.6L14.5 9.4L20.8 10L16.1 14.2L17.5 20.4L12 17.2L6.5 20.4L7.9 14.2L3.2 10L9.5 9.4z")],
  book: [
    path("M12 6.5C10.3 5 7.9 4.5 3.5 4.5v13c4.4 0 6.8.5 8.5 2 1.7-1.5 4.1-2 8.5-2v-13c-4.4 0-6.8.5-8.5 2z"),
    path("M12 6.5v13"),
  ],
  pencil: [path("M4 20l1-4.5L15.5 5a2.12 2.12 0 0 1 3 3L8 18.5z"), path("M13.5 7l3 3")],
  lock: [rect(4.5, 10.5, 15, 10, 2.5), path("M8 10.5v-3a4 4 0 0 1 8 0v3"), path("M12 14.5v2")],
  unlock: [rect(4.5, 10.5, 15, 10, 2.5), path("M8 10.5v-3a4 4 0 0 1 7.7-1.5"), path("M12 14.5v2")],
  clock: [circle(12, 12, 9), path("M12 7v5l3.5 2")],
  target: [circle(12, 12, 9), circle(12, 12, 5), dot(12, 12)],
  chart: [path("M4 20h16"), path("M7 16v-5"), path("M12 16V6"), path("M17 16v-8")],
  home: [path("M4 11.5 12 5l8 6.5"), path("M6.5 9.8V19h11V9.8"), path("M10 19v-5h4v5")],
  flame: [path("M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.2 1.6 1 2.6 2 3 0-3.2.3-5.4.8-8.2z")],
  coffee: [
    path("M4.5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"),
    path("M15.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8"),
    path("M8 3.5v2.5"),
    path("M12 3.5v2.5"),
  ],
  settings: [
    path("M4 6h8"),
    path("M16 6h4"),
    circle(14, 6, 2),
    path("M4 12h2"),
    path("M10 12h10"),
    circle(8, 12, 2),
    path("M4 18h10"),
    path("M18 18h2"),
    circle(16, 18, 2),
  ],
  plus: [path("M12 5v14"), path("M5 12h14")],
  minus: [path("M5 12h14")],
  x: [path("M6.5 6.5l11 11"), path("M17.5 6.5l-11 11")],
  check: [path("M5 12.5l4.5 4.5L19 7.5")],
  "chevron-down": [path("M6 9.5l6 6 6-6")],
  "chevron-up": [path("M6 14.5l6-6 6 6")],
  trash: [
    path("M4 7h16"),
    path("M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"),
    path("M6.5 7l.9 12.1a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"),
    path("M10.5 11v6"),
    path("M13.5 11v6"),
  ],
  globe: [
    circle(12, 12, 9),
    path("M3 12h18"),
    path("M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"),
  ],
  alert: [circle(12, 12, 9), path("M12 7.5v5"), dot(12, 16.3)],
  info: [circle(12, 12, 9), path("M12 11v5.5"), dot(12, 7.8)],
  shield: [path("M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6z")],
  sparkles: [
    path("M10 5.5c.6 4 2.9 6.9 7.5 7.5-4.6.6-6.9 3.5-7.5 7.5-.6-4-2.9-6.9-7.5-7.5 4.6-.6 6.9-3.5 7.5-7.5z"),
    path("M18 2.5c.5 2 1.5 3 3.5 3.5-2 .5-3 1.5-3.5 3.5-.5-2-1.5-3-3.5-3.5 2-.5 3-1.5 3.5-3.5z"),
  ],
  "arrow-right": [path("M5 12h14"), path("M13 6l6 6-6 6")],
  "arrow-left": [path("M19 12H5"), path("M11 6l-6 6 6 6")],
  calendar: [rect(3.5, 5, 17, 15.5, 2.5), path("M3.5 10h17"), path("M8 3v4"), path("M16 3v4")],
  phone: [rect(6.5, 2.5, 11, 19, 2.5), path("M11 18.5h2")],
  "eye-off": [
    path("M2.5 12c1.9-3.7 5.4-6 9.5-6s7.6 2.3 9.5 6c-1.9 3.7-5.4 6-9.5 6s-7.6-2.3-9.5-6z"),
    circle(12, 12, 3),
    path("M4 4l16 16"),
  ],
  puzzle: [path("M6.5 8h2a2 2 0 1 1 3.6 0h3.4v3a2 2 0 1 1 0 3.6v3.4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z")],
  pin: [path("M9 3.5h6"), path("M10 3.5v5.5l-3 3.5h10l-3-3.5V3.5"), path("M12 12.5v8")],
  // Pin step how-to: Edge's "show in toolbar" eye, Arc's site controls and link icons, the pointer.
  eye: [path("M2.5 12c1.9-3.7 5.4-6 9.5-6s7.6 2.3 9.5 6c-1.9 3.7-5.4 6-9.5 6s-7.6-2.3-9.5-6z"), circle(12, 12, 3)],
  sliders: [rect(3.5, 3.5, 17, 17, 4), path("M8 9.5h8"), path("M8 14.5h8"), ["circle", { cx: 10, cy: 9.5, r: 1.6, fill: "currentColor" }], ["circle", { cx: 14, cy: 14.5, r: 1.6, fill: "currentColor" }]],
  link: [path("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"), path("M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")],
  pointer: [path("M6 3.5l12.5 6.5-5.5 1.8 3.8 6.7-2.8 1.6-3.8-6.7L6 17.5z")],
  external: [
    path("M14 4.5h5.5V10"),
    path("M19.5 4.5L11 13"),
    path("M17 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4"),
  ],
};

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

export function icon(name, className = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  setAttributes(svg, {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    "data-icon": name,
  });
  if (className) svg.setAttribute("class", className);
  for (const [tag, attributes] of ICONS[name] ?? []) {
    const shape = document.createElementNS(SVG_NS, tag);
    setAttributes(shape, attributes);
    svg.appendChild(shape);
  }
  return svg;
}

function setAttributes(element, attributes) {
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
}
