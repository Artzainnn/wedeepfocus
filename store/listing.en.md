# Chrome Web Store listing (English)

Copy each block into the matching field of the Chrome Web Store developer dashboard.

## Name

```
WeDeepFocus
```

(Comes from `appName` in `i18n/common.json`. The store reads it from the manifest.)

## Short description (132 characters max)

```
Block distracting sites while you focus and see your goal instead. No account, no tracking.
```

91 characters. It is `appDescription` in `i18n/common.json`, keep both in sync (`build-locales` rejects more than 132 characters).

## Detailed description

```
WeDeepFocus keeps you off the sites that eat your time while you focus, and shows you what you're working toward instead.

OPEN A BLOCKED SITE, SEE YOUR GOAL
Instead of the feed: your goal, the time left and a short line to keep you going. One click takes you back to work.

GROUPS OF SITES, YOUR WAY
• Ready-made groups: social media, video and streaming, email and messaging, news, shopping (for example Instagram, TikTok, YouTube or Reddit)
• Turn a group on or off, add or remove its sites
• Create your own groups with a name and an icon, like "Work chat" or "Games"
• Add single sites to "Your sites", or block the current site in one click from the toolbar

YOU DECIDE WHEN
• Start a session from the toolbar icon: 15 minutes, 30 minutes, 1 hour or any length up to 8 hours
• Or add weekly time slots if you like, for example Monday to Friday, 09:00 to 12:00 (overnight slots work too)
• Live countdown in the popup and remaining time on the toolbar icon

STRICT, ON PURPOSE
• Ending a session early is a ritual: one honest question, then a sentence typed by hand (copy and paste disabled, typos rejected). Then the whole session ends. The pause is often enough to change your mind. You can always turn the extension off in chrome://extensions.
• The default sentence: "I am choosing to give up on my goals. I am trading my aspirations and commitments for a few minutes of distractions." You can write your own in the settings. It can't be changed while a block is running
• While a block is running, settings can only get stricter: you can add sites, groups or time slots, not remove them

PRIVATE BY DEFAULT
• No account, no analytics, no ads, no server
• Your settings stay in your browser (and in your own Chrome sync if you use it)
• Site access is optional and requested only for the sites you choose. It lets the extension show your goal instead of Chrome's error page. Without it, those sites are still blocked
• Start over from the settings: one button puts everything back to default

Free. If it helps you, there's an optional "Buy a dev a coffee" link in the popup and the settings.

Available in English and French.

Not affiliated with any of the websites mentioned. Trademarks belong to their owners.
```

## Category

Productivity, subcategory "Workflow & Planning" (or "Tools" if that subcategory is not offered).

## Language

Default language: English. The package also contains French (`_locales/fr`); add the French listing from `listing.fr.md`.

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

```
1. Install: the welcome page opens. Keep "Social media" selected and click Continue. Chrome asks for access to those sites: click Allow (if you decline, the sites are still blocked, with Chrome's error page instead of the goal page). "When I start a session" is already selected: click Continue. Type a goal, then click Finish.
2. Click "Start a 10 min session" on the last screen (or click the toolbar icon, pinned from the puzzle menu if needed, then "15 min" under "Block now for").
3. Open https://www.facebook.com: you land on the extension's page with your goal and a countdown instead.
4. "I really need it" (or "End session early" in the popup) starts the ritual: one question ("Is it really worth breaking your focus?"), then a sentence typed by hand. The whole session then ends. The sentence can be changed in Settings, under "Ending a session early".
No account or login is needed.
```

## Graphic assets

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `extension/assets/icon-128.png` | 128x128 (artwork 96x96 with transparent padding) |
| Small promo tile | `store/promo-small-440x280.png` | 440x280 |
| Marquee promo tile | `store/marquee-1400x560.png` | 1400x560 |
| Screenshots | `store/screenshots/en-*.png` | 1280x800 |

The promo tiles contain no localized text (only the brand name and a mock of the blocked page where the text is drawn as bars), because the store shows the same tiles in every language. Use them for both listings.

Suggested screenshot order and captions:

1. `en-1-blocked.png`: See your goal instead of the feed
2. `en-2-popup.png`: Start a focus session in one click
3. `en-3-options.png`: Group the sites that distract you, your way
4. `en-4-onboarding.png`: Set up in under a minute
5. `en-5-phrase.png`: Make the unlock sentence your own

Regenerate the images with `npm run icons` and `npm run screenshots`.
