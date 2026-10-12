# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the **Security** tab of this repository and click **Report a vulnerability**. Do not open a public issue for security problems.

Include what you found, how to reproduce it and what an attacker could do with it. You will get an answer as soon as possible, and credit in the fix if you want it.

## Scope

- The Chrome extension in `extension/` (latest version on the Chrome Web Store).
- The website and the payment functions in `landing/`.

## Design choices that matter for security

- **No remote code.** The extension only runs files from its own package and makes no network request of its own. The optional paid accountability feature, off in the published build, only talks to the configured payment server and only opens `https://checkout.stripe.com` pages.
- **Messages are trusted from the extension only.** The service worker ignores any message whose sender is not the extension itself, and no web page can message it (`externally_connectable` is not set).
- **The blocked page is the only web accessible resource.** It is needed so that blocked sites can be redirected to it. It never renders HTML from page data, only follows `http(s)` addresses for "continue", and disables the "end early" ritual when it is loaded inside a frame.
- **Least privilege.** Host access is optional and requested per site the user chooses to block.
- **Payments are verified on the server.** The payment functions check every input, never log tokens or request bodies, and read the Stripe key from the environment only. A session ends as paid only when Stripe reports `payment_status = paid` for a checkout created with the extension's one-time token.
- **No secrets in this repository.** Keys and deployment state (`.env*`, `.vercel/`) are ignored by git.
