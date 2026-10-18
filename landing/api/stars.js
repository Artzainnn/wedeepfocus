// GET /api/stars -> 200 { stars }
// Star count of the project's GitHub repository (githubUrl in site.config.mjs), for the badge in
// the site's nav. The CDN keeps the answer for an hour, so visitors never call GitHub themselves
// and GitHub sees about one request per hour.
import CONFIG from "../site.config.mjs";

const REPO = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/?$/.exec(CONFIG.githubUrl ?? "")?.[1] ?? null;

function answer(status, body, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    },
  });
}

const handler = {
  async fetch(request) {
    if (request.method !== "GET") {
      return new Response(null, { status: 405, headers: { allow: "GET" } });
    }
    if (!REPO) return answer(404, { error: "no_repository" }, "no-store");
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "wedeepfocus-site" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return answer(502, { error: "github_error" }, "public, s-maxage=300");
      const stars = Number((await res.json()).stargazers_count);
      if (!Number.isInteger(stars) || stars < 0) return answer(502, { error: "github_error" }, "public, s-maxage=300");
      return answer(200, { stars }, "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    } catch {
      return answer(502, { error: "github_unreachable" }, "public, s-maxage=300");
    }
  },
};

// Vercel accepts either the Web handler object or named HTTP method exports: offer both.
export default handler;
export const GET = (request) => handler.fetch(request);
