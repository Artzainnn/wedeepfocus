# Chrome Web Store listing (English)

Copy each block into the matching field of the Chrome Web Store developer dashboard.

## Name

```
WeDeepFocus
```

(Comes from `appName` in `i18n/common.json`. The store reads it from the manifest.)

## Short description (132 characters max)

```
Block distracting sites in two clicks and see why you're doing this instead. Free, open source, no account.
```

107 characters. It is `appDescription` in `i18n/common.json`, keep both in sync (`build-locales` rejects more than 132 characters).

## Detailed description

```
Instagram can wait. WeDeepFocus blocks the sites that pull you away while you focus, and shows you why you're doing this instead.

HOW IT WORKS
1. Pick what distracts you: social media, video, news, shopping, or your own sites.
2. Click the icon and pick 15 min, 30 min or 1 h. Or set weekly time slots, like weekdays from 09:00 to 12:00.
3. Open a blocked site: you see the time left and your why, one sentence you picked or wrote. One click takes you back to work.

NEED MORE TIME?
Add 15 minutes from the icon. The time left shows right on it.

ENDING EARLY TAKES EFFORT
One honest question, then a sentence typed by hand. No copy-paste allowed, typos are rejected. That pause is often enough to change your mind. While a session runs, settings can only get stricter.

YOUR SITES, YOUR WAY
• Ready-made groups (Instagram, TikTok, YouTube, Reddit and more), each with sites you can keep or remove
• Your own groups with a name and an icon, like "Work chat"
• Block the site you're on in one click from the toolbar

FREE, OPEN SOURCE, PRIVATE
• No account, no ads, no analytics: your settings stay in your browser
• Open source under the MIT license: github.com/Artzainnn/wedeepfocus
• Site access is optional and asked only for the sites you choose. Without it, those sites are still blocked, with Chrome's error page

Free. If it helps you, there's an optional "Buy a dev a coffee" link. Ideas or bugs? wedeepfocus.com/feedback

Works in Chrome and in Chromium browsers like Arc, Brave and Edge. English and French.

Not affiliated with any of the websites mentioned. Trademarks belong to their owners.
```

## Promo video

```
https://www.youtube.com/watch?v=yZ5A0IPuPWM
```

The "Global promo video" field of the store listing (37 s launch film). Use this long form: the dashboard refuses the youtu.be short link, and the whole save fails with it.

## Category

Productivity, subcategory "Workflow & Planning" (or "Tools" if that subcategory is not offered).

## Language

Default language: English. The package also contains French (`_locales/fr`), but the store has no French listing on purpose (decision of 18/10/2026): French visitors get the French summary from the package, the English description and the global screenshots.

## Single purpose

```
WeDeepFocus blocks the websites the user chooses, during the focus times the user sets (sessions started by hand or weekly time slots), and shows the user's own goal in place of those sites.
```

## Permission justifications

Manifest: `"permissions": ["declarativeNetRequest", "storage", "alarms", "activeTab"]` and `"optional_host_permissions": ["*://*/*"]`, no `host_permissions`. At install, Chrome shows a single warning, "Block content on any page", which comes from `declarativeNetRequest`: it is honest for a blocker, and the extension only ever blocks the sites the user picks.

**declarativeNetRequest**

```
Blocks or redirects only the websites the user chose to block, and only during the focus times the user set (a session started from the popup or weekly time slots). The rules are built on the device from the user's own groups and sites, and only match top-level page loads of those domains. Sites the user gave access to are redirected to the extension's own page showing the user's goal; the others get Chrome's standard error page. No other request is read, logged or modified, and page content is never read.
```

**Host permissions (optional_host_permissions: \*://\*/\*)**

```
Optional and never requested at install. The manifest lists *://*/* as optional only because the user can add any site. When the user picks sites to block, the extension asks Chrome for access to those sites only, at that moment (for example *://linkedin.com/* and *://*.linkedin.com/*). This access is used for two things: showing the user's goal page instead of Chrome's error page when one of those sites is opened during a block (a declarativeNetRequest redirect needs host access), and moving tabs already open on those sites to that page when a block starts or when such a tab changes address. No script is injected and page content is never read. If the user declines, the site is still blocked, with Chrome's error page.
```

**storage**

```
Saves the user's settings (groups of sites with their names and icons, the user's own sites, weekly time slots, goal, custom unlock sentence, preferences) in chrome.storage.sync, and the extension's state (end time of the current session, end of a session stopped early, the list of sites locked until the current block ends, today's counters shown to the user) in chrome.storage.local and chrome.storage.session. Settings are never sent to any server.
```

**alarms**

```
Starts and ends sessions and scheduled blocks on time, resumes schedules after a session stopped early, and keeps the remaining time on the toolbar icon up to date while a block is active.
```

**activeTab**

```
When the user opens the popup, the extension reads the address of the current tab to show its site name and offer a "Block this site" button. It does not access page content and has no access to other tabs.
```

**Remote code**

```
No, I am not using remote code. All JavaScript is included in the package.
```

## Privacy practices tab

What user data do you plan to collect from users now or in the future?

- Personally identifiable information: no
- Health information: no
- Financial and payment information: no
- Authentication information: no
- Personal communications: no
- Location: no
- Web history: no
- User activity: no
- Website content: no

Leave every box unchecked: the extension collects no user data and makes no network requests. The optional "Buy a dev a coffee" link only opens a Stripe page in a new tab. Everything it keeps is stored with `chrome.storage` in the user's browser: settings in `chrome.storage.sync`, which stays on the device, or is synced by Google in the user's own Google account when Chrome sync is on (the developer has no access to it), and runtime state in `chrome.storage.local` and `chrome.storage.session`, on this device only. The address of the current tab (read through activeTab when the popup opens) and the address of a blocked page (kept in the blocked page's own URL for its "Continue" button) are used on the device only, never stored elsewhere or transmitted. "Reset everything" in the settings deletes the synced settings and the local state.

Certifications (check all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

Privacy policy URL:

```
https://wedeepfocus.com/privacy/
```

Publish `PRIVACY.md` at a public address (for example GitHub Pages or your own site), add the contact email inside it, then paste its URL here.

## Test instructions for the reviewer

"Additional instructions" field of the Test instructions tab, 500 characters max. Optional (no login needed), still empty in the dashboard: its "Save changes" button stayed disabled when filled by script.

```
No account needed.
1. Welcome page: click Continue, Allow site access, Continue, then Finish (a sentence is preselected).
2. Pin the icon or click Skip, then "Start a 15 min session".
3. Open facebook.com: the extension's page shows the time left and your sentence.
4. "I really need it" asks one question, then a sentence typed by hand (no paste) to end the session early.
```

## Graphic assets

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `extension/assets/icon-128.png` | 128x128 (artwork 96x96 with transparent padding) |
| Small promo tile | `store/upload/promo-small-440x280.png` | 440x280 |
| Marquee promo tile | `store/upload/marquee-1400x560.png` | 1400x560 |
| Screenshots | `store/upload/en/en-*.png` | 1280x800, in both "Localized screenshots" and "Global screenshots" |

All of them come from `node scripts/store-visuals.mjs` (real captures of the extension with a headline). The promo tiles are in English: the store shows the same tiles in every language, so use them for both listings.

Suggested screenshot order and captions:

1. `en-1-blocked.png`: Instagram can wait (the blocked page: time left and your why)
2. `en-2-popup.png`: Focus in two clicks (start a session, add 15 minutes)
3. `en-3-groups.png`: Pick what distracts you
4. `en-4-why.png`: Remember why
5. `en-5-friction.png`: Ending early takes effort (no copy-paste)

Regenerate the images with `npm run icons` and `npm run screenshots`.
