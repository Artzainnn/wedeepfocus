// Tiny local HTTP server standing in for real websites during e2e tests.
// Chromium maps linkedin.com, example.org, ... to 127.0.0.1 (--host-resolver-rules),
// so every mapped host lands here. The page echoes the host and path it was asked for.
// Every request is recorded so tests can prove a blocked site was never reached.
import http from "node:http";

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function fixturePage(host, requestPath) {
  const safeHost = escapeHtml(host);
  const safePath = escapeHtml(requestPath);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture ${safeHost}</title></head>
<body>
<h1 data-testid="fixture-host">${safeHost}</h1>
<p data-testid="fixture-path">${safePath}</p>
</body>
</html>
`;
}

// Fake payment server (SPEC 13.8): same endpoints as landing/api, no Stripe. Tests decide when a
// Checkout Session counts as paid with payments.pay(sessionId) (or payments.autoPay = true).
function createPayments() {
  const sessions = new Map();
  let counter = 0;
  return {
    sessions,
    autoPay: false,
    unavailable: false,
    checkouts: 0,
    pay(sessionId) {
      const session = sessionId ? sessions.get(sessionId) : [...sessions.values()].at(-1);
      if (session) session.paid = true;
      return Boolean(session);
    },
    last() {
      return [...sessions.values()].at(-1) ?? null;
    },
    create({ amount, token }, port) {
      counter += 1;
      const id = `cs_test_${counter}`;
      sessions.set(id, { id, amount, token, paid: this.autoPay });
      this.checkouts += 1;
      return { url: `http://pay.test:${port}/checkout/${id}`, sessionId: id };
    },
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(body === null ? "" : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

async function handlePayment(req, res, payments, port) {
  const url = new URL(req.url, "http://local");
  if (req.method === "OPTIONS") return sendJson(res, 204, null);
  if (payments.unavailable) return sendJson(res, 502, { error: "stripe_error" });
  if (url.pathname === "/api/checkout" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "invalid_request" });
    }
    const valid = Number.isInteger(body.amount) && body.amount >= 1 && body.amount <= 500 && /^[a-f0-9]{32,64}$/.test(String(body.token));
    if (!valid) return sendJson(res, 400, { error: "invalid_request" });
    return sendJson(res, 200, payments.create(body, port));
  }
  if (url.pathname === "/api/verify" && req.method === "GET") {
    const session = payments.sessions.get(url.searchParams.get("session_id") ?? "");
    const paid = Boolean(session && session.paid && session.token === url.searchParams.get("token"));
    return sendJson(res, 200, { paid });
  }
  return sendJson(res, 404, { error: "not_found" });
}

export async function startFixtureServer() {
  const requests = [];
  const payments = createPayments();
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
    requests.push({ host, path: req.url, at: Date.now() });
    if (req.url.startsWith("/api/")) {
      handlePayment(req, res, payments, server.address().port);
      return;
    }
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fixturePage(host, req.url));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: server.address().port,
    payments,
    /** Requests received so far for `host` (all hosts when omitted), oldest first. */
    requests(host) {
      return host ? requests.filter((entry) => entry.host === host) : [...requests];
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
