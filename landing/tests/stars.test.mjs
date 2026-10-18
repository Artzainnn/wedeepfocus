// GET /api/stars: the GitHub star count, cached at the edge. GitHub is mocked.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import stars from "../api/stars.js";
import { fakeStripe as fakeFetch, readJson, stripeAnswer as answer } from "./helpers.js";

const get = (method = "GET") => stars.fetch(new Request("https://focus.example/api/stars", { method }));

describe("GET /api/stars", () => {
  let github;
  afterEach(() => github?.restore());

  test("returns the repository's star count with an hour of CDN cache", async () => {
    github = fakeFetch(() => answer(200, { stargazers_count: 42, owner: { login: "someone" } }));
    const res = await get();
    assert.equal(res.status, 200);
    assert.deepEqual(await readJson(res), { stars: 42 });
    assert.match(res.headers.get("cache-control"), /s-maxage=3600/);
    assert.equal(github.calls.length, 1);
    assert.match(github.calls[0].url, /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+$/);
  });

  test("answers 502 with a short cache when GitHub fails or sends nonsense", async () => {
    for (const reply of [() => answer(403, { message: "rate limited" }), () => answer(200, { stargazers_count: "lots" }), () => { throw new Error("offline"); }]) {
      github = fakeFetch(reply);
      const res = await get();
      assert.equal(res.status, 502);
      assert.match(res.headers.get("cache-control"), /s-maxage=300/);
      github.restore();
    }
    github = null;
  });

  test("only answers GET", async () => {
    github = fakeFetch(() => answer(200, { stargazers_count: 1 }));
    const res = await get("POST");
    assert.equal(res.status, 405);
    assert.equal(github.calls.length, 0);
  });
});
