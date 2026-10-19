// Bot traffic for DataFast. AI assistants and search crawlers skip the page's script, so Vercel
// runs this before serving a page, robots.txt or sitemap.xml: when the request comes from a known
// crawler, @datafast/ai-crawl tells DataFast in the background. Requests from people are never sent.
// Needs DATAFAST_ID in the Vercel environment (DATAFAST_BOT_TOKEN is optional); does nothing without it.
import { trackAICrawlerRequest } from "@datafast/ai-crawl";

export const config = {
  matcher: ["/((?!assets/|js/|api/).*)"],
};

export default function middleware(request, context) {
  const websiteId = process.env.DATAFAST_ID;
  if (!websiteId) return;
  // Not awaited: the package hands the call to context.waitUntil and the page is served at once.
  trackAICrawlerRequest(request, context, {
    websiteId,
    authToken: process.env.DATAFAST_BOT_TOKEN || undefined,
  });
}
