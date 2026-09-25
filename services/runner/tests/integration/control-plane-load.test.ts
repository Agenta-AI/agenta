/**
 * QA R3 API finding QA3A-1: under a burst of new sessions the platform throttled the runner's
 * own control-plane calls, and every turn whose admission beat got a 429 was refused as "already
 * running a turn". This drives 40 new sessions at once through the runner's HTTP surface against
 * a control plane that throttles like the platform's (429 with Retry-After past its budget) and
 * requires every turn to be admitted and to finish.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentServer } from "../../src/server.ts";
import { SESSION_TURN_IN_USE_MESSAGE } from "../../src/sessions/admission.ts";

const TOKEN = "load-test-runner-token";

/** A token bucket in requests: `capacity` at once, refilled at `perSecond`. */
function throttle(capacity: number, perSecond: number) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("40 new sessions at once against a throttling control plane", () => {
  it("admits and finishes every turn; a 429 never reads as another turn owning the session", async () => {
    vi.stubEnv("AGENTA_API_URL", "https://api.example.test/api");
    process.env.AGENTA_RUNNER_TOKEN = TOKEN;
    const server = createAgentServer(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, output: "done", events: [] };
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const realFetch = globalThis.fetch.bind(globalThis);
    const allow = throttle(15, 15);
    let throttled = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      if (!allow()) {
        throttled += 1;
        return new Response(JSON.stringify({ detail: "Rate limit exceeded. Please retry after 1 seconds." }), {
          status: 429,
          headers: { "retry-after": "1", "content-type": "application/json" },
        });
      }
      if (url.endsWith("/sessions/streams/heartbeat")) {
        return Response.json({ stream: { id: "stream" }, is_current_turn: true });
      }
      return Response.json({ ok: true });
    });

    const run = async (i: number) => {
      const response = await realFetch(`${base}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ harness: "pi_core", sessionId: `load-session-${i}`, projectId: "project-1", messages: [{ role: "user", content: "hi" }] }),
      });
      const lines = (await response.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      return lines.find((l) => l.kind === "result")?.result as { ok: boolean; error?: string } | undefined;
    };
    try {
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => run(i)));
      expect(throttled).toBeGreaterThan(0);
      expect(results.filter((r) => r?.error === SESSION_TURN_IN_USE_MESSAGE)).toHaveLength(0);
      expect(results.filter((r) => r?.ok)).toHaveLength(40);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
