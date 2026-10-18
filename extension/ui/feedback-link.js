// The "Feedback" link at the bottom of the side menu (home, settings and stats pages).
import { feedbackUrl } from "../shared/feedback.js";
import { uiLocale } from "../shared/i18n.js";

export function mountFeedbackLink() {
  const link = document.querySelector('[data-testid="nav-feedback"]');
  if (!link) return;
  const url = feedbackUrl(uiLocale(), "menu", chrome.runtime.getManifest().version);
  link.hidden = !url;
  if (url) link.href = url;
}
