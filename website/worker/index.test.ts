import { describe, expect, it } from "vitest";
import worker from "./index";

// A stand-in for the Workers ASSETS binding: a map of path -> response, with
// the same not_found_handling: "none" behavior the real binding has (a miss is
// a bare 404; the worker fetches /404.html itself).
function assets(files: Record<string, { body: string; type: string }>) {
  return {
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      const file = files[path];
      if (file) {
        return new Response(file.body, {
          status: 200,
          headers: { "Content-Type": file.type },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}

const SITE = assets({
  "/pricing": { body: "<!doctype html><h1>Pricing</h1>", type: "text/html" },
  "/pricing.md": { body: "# Pricing\n", type: "text/markdown" },
  "/imprint": { body: "<!doctype html><h1>Imprint</h1>", type: "text/html" },
  "/openapi.json": { body: "{}", type: "application/json" },
  "/404.html": {
    body: "<!doctype html><h1>This page ran off.</h1>",
    type: "text/html; charset=utf-8",
  },
});

const get = (path: string, accept?: string, method = "GET") =>
  worker.fetch(
    new Request(`https://agenta.ai${path}`, {
      method,
      headers: accept ? { accept } : {},
    }),
    { ASSETS: SITE },
  );

describe("markdown negotiation", () => {
  it("serves the markdown twin when markdown is preferred", async () => {
    const response = await get("/pricing", "text/markdown");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("vary")).toContain("Accept");
    expect(await response.text()).toContain("# Pricing");
  });

  it("keeps the markdown variant out of shared caches", async () => {
    const response = await get("/pricing", "text/markdown");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("406s a markdown-only client when no twin was built", async () => {
    // Honest: we cannot serve what it asked for, and it ruled out HTML.
    // verify-build.mjs makes a missing twin a build failure, not a runtime one.
    const response = await get("/imprint", "text/markdown");
    expect(response.status).toBe(406);
  });

  it("falls back to HTML when the client also accepts it", async () => {
    const response = await get("/imprint", "text/markdown, text/html;q=0.5");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("prefers the twin over HTML for a client that wants JSON first", async () => {
    // No JSON representation of a page exists, so markdown is the honest answer.
    const response = await get("/pricing", "application/json, text/markdown");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });

  it("406s a page request that only accepts JSON", async () => {
    const response = await get("/pricing", "application/json");
    expect(response.status).toBe(406);
  });

  it("advertises the twin and Vary on the HTML page", async () => {
    const response = await get("/pricing", "text/html");
    expect(response.headers.get("vary")).toContain("Accept");
    expect(response.headers.get("link")).toContain(
      '</pricing.md>; rel="alternate"; type="text/markdown"',
    );
    // The _headers policy, re-applied because Cloudflare drops it here.
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("leaves asset paths completely alone", async () => {
    const response = await get("/openapi.json", "text/markdown");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("vary")).toBeNull();
  });
});

describe("406", () => {
  it("rejects a fully specified Accept we cannot satisfy", async () => {
    const response = await get("/pricing", "image/webp");
    expect(response.status).toBe(406);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("vary")).toContain("Accept");
    const body = await response.json();
    expect(body.error.code).toBe("not_acceptable");
  });

  it("never 406s a browser or a wildcard client", async () => {
    for (const accept of [
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "*/*",
      undefined,
    ]) {
      expect((await get("/pricing", accept)).status).toBe(200);
    }
  });
});

describe("404", () => {
  it("answers JSON askers with a structured error", async () => {
    const response = await get("/nope", "application/json");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.hints.length).toBeGreaterThan(0);
    expect(body.error.sitemap).toContain("sitemap-index.xml");
    expect(body.error.llms_txt).toContain("llms.txt");
  });

  it("answers /api/* with JSON even without an Accept header", async () => {
    const response = await get("/api/anything");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("answers markdown askers with a markdown recovery note", async () => {
    const response = await get("/nope", "text/markdown");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("/sitemap-index.xml");
  });

  it("keeps the designed HTML page for browsers and bare curl", async () => {
    for (const accept of ["text/html", "*/*", undefined]) {
      const response = await get("/nope", accept);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("This page ran off.");
    }
  });
});

describe("robustness", () => {
  it("sends no body for HEAD but keeps the headers", async () => {
    const response = await get("/pricing", "text/markdown", "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(await response.text()).toBe("");
  });

  it("passes non-GET methods straight through", async () => {
    const response = await get("/pricing", "text/markdown", "POST");
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("still serves the site when the binding misbehaves", async () => {
    // A negotiation bug must never be able to 500 the marketing site.
    let calls = 0;
    const flaky = {
      async fetch(request: Request) {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return new Response("<!doctype html><h1>ok</h1>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
    };
    const response = await worker.fetch(
      new Request("https://agenta.ai/pricing", {
        headers: { accept: "text/markdown" },
      }),
      { ASSETS: flaky },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ok");
  });
});
