// Preset site groups and group helpers. Pure module: no chrome, no document.
// Domains are normalized (lowercase, no "www."). Blocking a domain also blocks its subdomains.

const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const NEW_ID_LENGTH = 8;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]+/g;

export const PRESETS = deepFreeze([
  {
    id: "social",
    icon: "users",
    domains: {
      all: [
        "facebook.com",
        "instagram.com",
        "x.com",
        "twitter.com",
        "tiktok.com",
        "linkedin.com",
        "reddit.com",
        "threads.com",
        "threads.net",
        "snapchat.com",
        "pinterest.com",
        "bsky.app",
      ],
    },
  },
  {
    id: "video",
    icon: "play",
    domains: {
      all: ["youtube.com", "netflix.com", "twitch.tv", "primevideo.com", "disneyplus.com"],
    },
  },
  {
    id: "messaging",
    icon: "mail",
    domains: {
      // Gmail only: never "google.com", which would block Search, Docs, Drive...
      all: [
        "mail.google.com",
        "outlook.live.com",
        "outlook.office.com",
        "web.whatsapp.com",
        "messenger.com",
        "web.telegram.org",
      ],
    },
  },
  {
    id: "news",
    icon: "news",
    domains: {
      en: ["cnn.com", "bbc.com", "bbc.co.uk", "nytimes.com", "theguardian.com", "foxnews.com", "espn.com"],
      fr: ["lemonde.fr", "lefigaro.fr", "bfmtv.com", "20minutes.fr", "liberation.fr", "francetvinfo.fr", "lequipe.fr"],
    },
  },
  {
    id: "shopping",
    icon: "cart",
    domains: {
      all: ["amazon.com", "aliexpress.com", "temu.com", "shein.com", "ebay.com"],
      en: ["amazon.co.uk", "etsy.com"],
      fr: ["amazon.fr", "leboncoin.fr", "vinted.fr", "cdiscount.com"],
    },
  },
]);

export function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

export function presetLanguage(locale) {
  return typeof locale === "string" && /^fr(?:[-_]|$)/i.test(locale) ? "fr" : "en";
}

export function presetDomains(presetOrId, locale) {
  const preset = typeof presetOrId === "string" ? getPreset(presetOrId) : presetOrId;
  if (!preset || typeof preset !== "object" || !preset.domains) return [];
  const { domains } = preset;
  const localized = domains[presetLanguage(locale)];
  return [...new Set([...(domains.all ?? []), ...(localized ?? [])])];
}

// The 5 presets as groups, in order, with their domains for `locale`. Only social starts enabled.
export function defaultGroups(locale) {
  return PRESETS.map((preset) => ({
    id: preset.id,
    preset: preset.id,
    name: "",
    icon: preset.icon,
    domains: presetDomains(preset, locale),
    enabled: preset.id === "social",
  }));
}

// The user's name for the group, else the localized preset name (translate is i18n.t).
export function groupDisplayName(group, translate) {
  if (!group || typeof group !== "object") return "";
  if (typeof group.name === "string" && group.name) return group.name;
  return group.preset && typeof translate === "function" ? translate(`category_${group.preset}`) : "";
}

// "g_" followed by 8 random base36 characters.
export function newGroupId() {
  return `g_${randomIndexes(NEW_ID_LENGTH, ID_ALPHABET.length).map((index) => ID_ALPHABET[index]).join("")}`;
}

function randomIndexes(count, size) {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    return Array.from(cryptoApi.getRandomValues(new Uint32Array(count)), (value) => value % size);
  }
  return Array.from({ length: count }, () => Math.floor(Math.random() * size));
}

// Preset ids and newGroupId() ids both qualify: letters, digits, "_" and "-", 64 at most.
export function isGroupId(value) {
  return typeof value === "string" && GROUP_ID_PATTERN.test(value);
}

// Group name as stored: control characters become spaces, surrounding spaces go. "" for non strings.
export function cleanGroupName(value) {
  return typeof value === "string" ? value.replace(CONTROL_CHARS, " ").trim() : "";
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
