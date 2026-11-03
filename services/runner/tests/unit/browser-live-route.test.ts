/**
 * `POST /browser/live`: the status codes and bodies the api relies on.
 *
 * The handler runs on a real HTTP server with a fake lookup; the token gate runs through
 * `createAgentServer`, which checks it before the handler is called.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/browser-live-route.test.ts
 */
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "vitest";

import type { LiveLinkLookup, LiveLinkScope } from "../../src/browser/live-link.ts";
import { handleBrowserLiveRoute } from "../../src/browser/live-route.ts";
import { createAgentServer } from "../../src/server.ts";

const LINK = {
  url: "wss://8790-sbx.proxy.example/live",
  headers: { "x-agenta-browser-token": "browser-token" },
  page: { waiting: "", url: "https://example.com/", title: "Example" },
};

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/browser/live`;
}

async function route(lookup: LiveLinkLookup): Promise<string> {
  return listen(http.createServer((req, res) => void handleBrowserLiveRoute(req, res, lookup)));
}

async function post(url: string, body: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: "POST", body, headers });
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
}

const scopeBody = JSON.stringify({ projectId: " project-1 ", sessionId: " session-1 " });

describe("POST /browser/live", () => {
  it("answers 401 without the runner token", async () => {
    const previous = process.env.AGENTA_RUNNER_TOKEN;
    process.env.AGENTA_RUNNER_TOKEN = "test-runner-token";
    try {
      const url = await listen(createAgentServer(async () => ({ ok: true, output: "", events: [] })));
      assert.deepEqual(await post(url, scopeBody), {
        status: 401,
        cache: null,
        body: { ok: false, error: "Unauthorized" },
      });
    } finally {
      if (previous === undefined) delete process.env.AGENTA_RUNNER_TOKEN;
      else process.env.AGENTA_RUNNER_TOKEN = previous;
    }
  });

  it("answers 200 with the link for the trimmed scope", async () => {
    const scopes: LiveLinkScope[] = [];
    const url = await route(async (scope) => {
      scopes.push(scope);
      return LINK;
    });
    assert.deepEqual(await post(url, scopeBody), { status: 200, cache: "no-store", body: LINK });
    assert.deepEqual(scopes, [{ projectId: "project-1", sessionId: "session-1" }]);
  });

  it("answers 404 when no browser is live", async () => {
    const url = await route(async () => undefined);
    assert.deepEqual(await post(url, scopeBody), {
      status: 404,
      cache: "no-store",
      body: { ok: false, error: "No browser is running in this session" },
    });
  });

  it("answers 502 when the lookup fails", async () => {
    const url = await route(async () => {
      throw new Error("daytona down");
    });
    assert.deepEqual(await post(url, scopeBody), {
      status: 502,
      cache: "no-store",
      body: { ok: false, error: "daytona down" },
    });
  });

  it("answers 400 to a body that is not JSON", async () => {
    const url = await route(async () => LINK);
    assert.deepEqual(await post(url, "{not json"), {
      status: 400,
      cache: "no-store",
      body: { ok: false, error: "Invalid JSON" },
    });
  });

  for (const [name, body] of [
    ["an empty body", ""],
    ["a missing sessionId", JSON.stringify({ projectId: "project-1" })],
    ["a blank projectId", JSON.stringify({ projectId: "  ", sessionId: "session-1" })],
    ["a JSON null", "null"],
  ] as const) {
    it(`answers 400 to ${name}`, async () => {
      let looked = false;
      const url = await route(async () => {
        looked = true;
        return LINK;
      });
      assert.deepEqual(await post(url, body), {
        status: 400,
        cache: "no-store",
        body: { ok: false, error: "sessionId and projectId are both required" },
      });
      assert.equal(looked, false);
    });
  }

  it("answers 413 to a body over the cap", async () => {
    let looked = false;
    const url = await route(async () => {
      looked = true;
      return LINK;
    });
    const res = await post(
      url,
      JSON.stringify({ projectId: "p".repeat(32 * 1024), sessionId: "session-1" }),
    ).catch((error: unknown) => error);
    assert.equal(looked, false);
    // The handler destroys the request once the cap is crossed, so the client may see the reset
    // before the 413.
    if (res instanceof Error) return;
    assert.deepEqual(res, {
      status: 413,
      cache: "no-store",
      body: { ok: false, error: "request body too large" },
    });
  });
});
