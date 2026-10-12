// Website settings. Forking? Change these values, nothing else (the name comes from appName in
// i18n/common.json). Every value here is public: it ends up in the built pages.
export default {
  // Canonical address of the site: canonical links, og:url and the sitemap. "" to skip them.
  siteUrl: "https://wedeepfocus.com",
  // Chrome Web Store listing behind every "Add to Chrome" button.
  storeUrl: "https://chromewebstore.google.com/",
  // Public source code, linked from the nav, the privacy section, the FAQ and the footer.
  githubUrl: "https://github.com/Artzainnn/wedeepfocus",
  // Contact address in the footer and the privacy policy. "" to hide it.
  contactEmail: "",
  // DataFast website id for visit analytics on the website only (never in the extension), loaded
  // through the site's own domain (see the rewrites in vercel.json). Kept out of the repository:
  // set it in landing/site.local.mjs (ignored by git) or the DATAFAST_ID environment variable.
  // Empty: no analytics.
  datafastId: process.env.DATAFAST_ID || "",
};
