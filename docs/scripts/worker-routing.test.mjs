// Run against the Cloudflare asset server, not `docusaurus serve`: the latter
// does not apply assets.html_handling and cannot reproduce the /docs bug.
// DOCS_ORIGIN=http://localhost:8787 node --test scripts/worker-routing.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.DOCS_ORIGIN;
if (!origin) {
  throw new Error("Set DOCS_ORIGIN to a running docs Worker or wrangler dev server.");
}

async function get(path, redirect = "follow") {
  return fetch(new URL(path, origin), {
    redirect,
    signal: AbortSignal.timeout(30_000),
  });
}

test("the bare homepage redirects to Docusaurus's /docs/ parent route", async () => {
  const response = await get("/docs?search-test=1", "manual");
  assert.ok([301, 302, 307, 308].includes(response.status));
  const location = new URL(response.headers.get("location"), origin);
  assert.equal(location.pathname, "/docs/");
  assert.equal(location.search, "?search-test=1");
});

test("the canonical homepage serves HTML without another redirect", async () => {
  const response = await get("/docs/", "manual");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /DocSearch-Button/);
  assert.match(html, /docs-doc-id-getting-started\/introduction/);
});

test("leaf and versioned routes keep their existing slashless URLs", async () => {
  for (const path of [
    "/docs/concepts/agents",
    "/docs/1.0",
    "/docs/reference/api-guide/overview",
    "/docs/changelog",
    "/docs/roadmap",
  ]) {
    const response = await get(path, "manual");
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /text\/html/, path);
  }
});

test("leaf trailing slashes redirect without a loop", async () => {
  const response = await get("/docs/concepts/agents/");
  assert.equal(response.status, 200);
  assert.equal(new URL(response.url).pathname, "/docs/concepts/agents");
});
