// Website settings. Forking? Change these values, nothing else (the name comes from appName in
// i18n/common.json). Every value here is public: it ends up in the built pages.
export default {
  // Canonical address of the site: canonical links, og:url and the sitemap. "" to skip them.
  siteUrl: "https://wedeepfocus.com",
  // Chrome Web Store listing behind every "Add to Chrome" button.
  storeUrl: "https://chromewebstore.google.com/detail/wedeepfocus/jbhlbkglabiceehaphjjnfiohkkkkomi",
  // Public source code, linked from the nav, the privacy section, the FAQ and the footer.
  githubUrl: "https://github.com/Artzainnn/wedeepfocus",
  // Contact address in the footer and the privacy policy. "" to hide it.
  contactEmail: "",
  // DataFast website id for visit analytics on the website only (never in the extension), loaded
  // through the site's own domain (see the rewrites in vercel.json). Kept out of the repository:
  // set it in landing/site.local.mjs (ignored by git) or the DATAFAST_ID environment variable.
  // Empty: no analytics.
  datafastId: process.env.DATAFAST_ID || "",
  // Web3Forms access key for the feedback form (/feedback/): messages arrive by email. The key is
  // meant to be public but sends to its owner's inbox, so it lives in landing/site.local.mjs (or the
  // WEB3FORMS_KEY environment variable). Empty: the page links to GitHub issues instead.
  web3formsKey: process.env.WEB3FORMS_KEY || "",
  // "Made by" section above the footer: who built it and their other work. null to hide it.
  // Logos live in landing/src/brands/.
  maker: {
    name: "Maxime",
    url: "https://buildingitmyway.com",
    links: [
      { name: ".labs", tag: { en: "Waitlist", fr: "Liste d'attente" }, logo: "labs.png", url: "https://thelabscompany.com",
        text: { en: "The new domain for builders. Get yourname.labs.", fr: "Le nouveau domaine des builders. Réserve tonnom.labs." } },
      { name: "MediaBoost", tag: "PR", logo: "mediaboost.png", url: "https://mediaboost.press",
        text: { en: "Get covered by 500+ top media outlets.", fr: "Parais dans plus de 500 grands médias." } },
      { name: "Building It My Way", tag: "YouTube", icon: "youtube", url: "https://www.youtube.com/@Buildingitmyway",
        text: { en: "Watch me build startups, unscripted.", fr: "Je construis mes startups devant la caméra, sans filtre." } },
      { name: "ClaudeUsageBar", tag: { en: "Free · macOS", fr: "Gratuit · macOS" }, logo: "claudeusagebar.png", url: "https://claudeusagebar.com",
        text: { en: "Track your Claude usage in the menu bar.", fr: "Suis ta consommation Claude dans la barre de menus." } },
      { name: "CodexUsageBar", tag: { en: "Free · macOS", fr: "Gratuit · macOS" }, logo: "codexusagebar.png", url: "https://codexusagebar.com",
        text: { en: "Track your Codex usage in the menu bar.", fr: "Suis ta consommation Codex dans la barre de menus." } },
    ],
  },
};
