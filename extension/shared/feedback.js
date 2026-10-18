// Feedback page links (FEEDBACK_URLS in config.js). Pure module: no chrome, no document.
import { FEEDBACK_URLS } from "./config.js";

// The page for this language, tagged with where the visitor comes from ("menu", "uninstall") and
// the extension version. Nothing about the user goes in the address. "" when no page is set up.
export function feedbackUrl(locale, from, version = "") {
  const base = String(locale ?? "").toLowerCase().startsWith("fr") ? FEEDBACK_URLS.fr : FEEDBACK_URLS.other;
  let url;
  try {
    url = new URL(base);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (from) url.searchParams.set("from", String(from));
  if (version) url.searchParams.set("v", String(version));
  return url.href;
}
