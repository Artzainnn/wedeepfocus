// Domain normalization, matching and permission coverage. Pure module: no chrome, no document.

const MAX_INPUT_LENGTH = 2048;
const WEB_SCHEMES = ["http", "https"];

export function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (!text || text.length > MAX_INPUT_LENGTH) return null;

  // Any scheme is dropped so the rest always goes through the http parser (IDN to punycode, IPv4 detection).
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^\/\//, "");
  // Only the authority matters: a path, query or hash (even with spaces) is ignored.
  let authority = text.split(/[/?#\\]/, 1)[0];
  // Wildcards and leading dots ("*.example.com", ".example.com") mean the same thing as the domain itself.
  authority = authority.replace(/^\*\./, "").replace(/^\.+/, "");
  if (!authority || /\s/.test(authority)) return null;

  let host;
  try {
    host = new URL(`http://${authority}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "");
  if (host.startsWith("www.") && host.indexOf(".", 4) !== -1) host = host.slice(4);
  return isValidHostname(host) ? host : null;
}

function isValidHostname(host) {
  if (!host || host.length > 253 || host.startsWith("[")) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  const labelsOk = labels.every(
    (label) => label.length >= 1 && label.length <= 63 && /^[a-z0-9_-]+$/.test(label) && !/^-|-$/.test(label),
  );
  if (!labelsOk) return false;
  // Rejects IPv4 addresses (numeric last label) and made up single letter TLDs.
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/.test(tld) || /^xn--[a-z0-9-]{1,59}$/.test(tld);
}

export function hostMatches(host, domain) {
  if (typeof host !== "string" || typeof domain !== "string" || !domain) return false;
  const cleanHost = host.toLowerCase().replace(/\.$/, "");
  return cleanHost === domain || cleanHost.endsWith(`.${domain}`);
}

export function findBlockingDomain(host, domains) {
  let best = null;
  for (const domain of asArray(domains)) {
    if (hostMatches(host, domain) && (best === null || domain.length > best.length)) best = domain;
  }
  return best;
}

// Every domain to block: the enabled groups' domains plus the user's own sites (sites.custom),
// normalized, without subdomains of a listed parent, sorted. Takes the settings (or { groups, sites }).
export function effectiveDomains(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const result = new Set();
  for (const group of asArray(source.groups)) {
    if (!group || typeof group !== "object" || group.enabled !== true) continue;
    for (const domain of normalizeAll(group.domains)) result.add(domain);
  }
  for (const domain of normalizeAll(source.sites?.custom)) result.add(domain);
  return dropCoveredSubdomains(result).sort();
}

function normalizeAll(list) {
  return asArray(list).map(normalizeDomain).filter(Boolean);
}

// "mail.google.com" is redundant when "google.com" is in the list.
function dropCoveredSubdomains(domainSet) {
  return [...domainSet].filter((domain) => {
    for (let dot = domain.indexOf("."); dot !== -1; dot = domain.indexOf(".", dot + 1)) {
      if (domainSet.has(domain.slice(dot + 1))) return false;
    }
    return true;
  });
}

export function originPatterns(domains) {
  const patterns = new Set();
  for (const domain of asArray(domains)) {
    if (typeof domain !== "string" || !domain) continue;
    patterns.add(`*://${domain}/*`);
    patterns.add(`*://*.${domain}/*`);
  }
  return [...patterns];
}

// A domain is covered when, for both http and https, its apex and all its subdomains are matched.
// Chrome match patterns: "*.x.com" matches x.com and every subdomain; "*" matches every host.
export function domainsForOrigins(origins, domains) {
  const patterns = asArray(origins).map(parseOriginPattern).filter(Boolean);
  if (patterns.length === 0) return [];
  return asArray(domains).filter(
    (domain) => typeof domain === "string" && WEB_SCHEMES.every((scheme) => isFullyCovered(domain, scheme, patterns)),
  );
}

function parseOriginPattern(origin) {
  if (typeof origin !== "string") return null;
  if (origin === "<all_urls>") return { schemes: WEB_SCHEMES, host: "", subdomains: true };
  const match = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(?:\/.*)?$/i.exec(origin.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const schemes = scheme === "*" ? WEB_SCHEMES : WEB_SCHEMES.filter((web) => web === scheme);
  if (schemes.length === 0) return null;

  let host = match[2].toLowerCase();
  const port = /:([^:\]]*)$/.exec(host);
  if (port) {
    // A pattern limited to one port does not cover normal navigations.
    if (port[1] !== "*") return null;
    host = host.slice(0, port.index);
  }
  host = host.replace(/\.$/, "");
  if (host === "*") return { schemes, host: "", subdomains: true };
  if (host.startsWith("*.")) {
    const base = host.slice(2);
    return base && !base.includes("*") ? { schemes, host: base, subdomains: true } : null;
  }
  if (!host || host.includes("*")) return null;
  return { schemes, host, subdomains: false };
}

function isFullyCovered(domain, scheme, patterns) {
  const forScheme = patterns.filter((pattern) => pattern.schemes.includes(scheme));
  const apex = forScheme.some((pattern) => coversHost(pattern, domain));
  const subdomains = forScheme.some(
    (pattern) => pattern.subdomains && (pattern.host === "" || hostMatches(domain, pattern.host)),
  );
  return apex && subdomains;
}

function coversHost(pattern, host) {
  if (pattern.host === "") return true;
  return pattern.subdomains ? hostMatches(host, pattern.host) : host === pattern.host;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
