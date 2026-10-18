# WeDeepFocus

**Block distracting sites in two clicks. Remember why you're doing this.**

WeDeepFocus is a free Chrome extension for focus sessions. Pick the sites that pull you away, start a session from the toolbar, and when you open one of them you see the time left and your own why instead of the feed. Ending a session early takes a moment: one honest question, then a sentence to type by hand.

No account, no analytics, no server: your settings stay in your browser.

[Chrome Web Store](https://chromewebstore.google.com/detail/wedeepfocus/jbhlbkglabiceehaphjjnfiohkkkkomi) · [Website](https://wedeepfocus.com) · [Video (37 s)](https://youtu.be/yZ5A0IPuPWM) · [Privacy policy](https://wedeepfocus.com/privacy/) · English and French

## Features

- **Groups of sites**: ready-made groups (social media, video, email, news, shopping) and your own groups with a name and an icon. Turn a group on or off, add or remove sites, or block the current site from the toolbar.
- **Sessions in two clicks**: 15 minutes, 30 minutes, 1 hour or any length up to 8 hours, from the toolbar popup. Or weekly time slots (overnight slots work too).
- **Your why instead of the feed**: blocked sites show the time left and one sentence on why you're doing this.
- **Strict on purpose**: during a block, settings can only get stricter. Ending early means typing a sentence by hand (paste and typos are refused).
- **Stats that stay local**: focus time, sites blocked, sessions completed and a daily streak, kept in your browser for one year.

## Privacy and security

- The extension makes **no network request of its own**. Settings live in `chrome.storage.sync` (synced by Chrome in your own Google account if Chrome sync is on), runtime state and stats in `chrome.storage.local`.
- **Minimal permissions**: `declarativeNetRequest`, `storage`, `alarms`, `activeTab`. Access to a site is optional and only requested for the sites you choose to block; without it, the site is still blocked with Chrome's error page.
- **No remote code**: every file that runs is in the package reviewed by the Chrome Web Store.
- The website (wedeepfocus.com) counts visits with DataFast. The extension never loads it.

See [PRIVACY.md](PRIVACY.md) for the full policy and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

Requirements: Node.js 22+, Chrome 121+, Python 3 with Pillow (only to regenerate icons).

```bash
npm install
npm test                         # unit tests
npx playwright install chromium  # once, for the end-to-end tests
npm run test:e2e                 # end-to-end tests in a real Chromium with the extension loaded
```

Load the extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `extension/` folder.

| Command | What it does |
| --- | --- |
| `npm run build:locales` | Builds `extension/_locales` from the `i18n/*.json` files |
| `npm run zip` | Builds `dist/wedeepfocus-v<version>.zip` for the Chrome Web Store (checks locales, files and permissions first) |
| `npm run icons` | Redraws the icons and the store promo tiles |
| `npm run screenshots` | Takes the store screenshots in English and French |

### Project layout

```
extension/          Manifest V3 extension, plain JavaScript modules, no build step
  background/       Service worker: blocking rules, sessions, schedules, alarms
  popup/ options/   Toolbar popup and settings page
  home/ stats/      Home and stats pages
  blocked/          The page shown instead of a blocked site, and the "end early" ritual
  onboarding/       First run setup
  shared/           Pure modules (storage, schedule, domains, stats, i18n...) and config.js
i18n/               Translations (English and French), compiled into extension/_locales
landing/            Website (static, built by build.mjs) and the optional payment functions (api/)
tests/unit          Node test runner, no browser
tests/e2e           Playwright with the real extension loaded in Chromium
docs/SPEC.md        The original product and technical spec
store/              Chrome Web Store texts and images
```

## Make it your own

Everything specific to the WeDeepFocus deployment lives in three places:

1. `i18n/common.json`: `appName`, `appShortName` and `appDescription` (the name shown everywhere).
2. `extension/shared/config.js`: the "Buy a dev a coffee" links (leave empty to hide them), the payment server address and the switch for paid accountability.
3. `landing/site.config.mjs`: website address, Chrome Web Store link, GitHub link, contact email and the "Made by" section (set `maker: null` to remove it). Values you would rather keep out of git (like an analytics id) go in `landing/site.local.mjs`, which is ignored: `export default { datafastId: "dfid_..." };`

Then run `npm run build:locales`, `npm run icons` and `npm run zip`.

## Website and payment functions

The website is static: `node landing/build.mjs` writes it to `landing/public` (add `--og` to also render the social preview image). It deploys to any static host; `landing/vercel.json` is set up for Vercel, including the rewrites that serve DataFast from the site's own domain.

`landing/api/stars.js` serves the GitHub star count shown in the nav, cached for an hour by the CDN so visitors never call GitHub themselves.

`landing/api/` also holds two optional serverless functions for paid accountability (paying a chosen amount to end a session early, verified with Stripe on the server). This feature is **off** in the published extension (`ACCOUNTABILITY_ENABLED = false`). To use it on your own deployment, set these environment variables on your host, never in the code:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | A Stripe secret key, ideally a restricted key with Checkout Sessions write, Prices write and Products read |
| `SITE_URL` | Your website address, used for Stripe's return pages |
| `STRIPE_ACCOUNTABILITY_PRODUCT` | Optional Stripe product id to group the payments |

Run the function tests with `node --test "landing/tests/*.test.mjs"`.

## Contributing

Issues and pull requests are welcome. Please run `npm test` (and `npm run test:e2e` for anything that touches the extension) before opening a pull request, and keep the extension free of network requests and remote code.

## License

[MIT](LICENSE)
