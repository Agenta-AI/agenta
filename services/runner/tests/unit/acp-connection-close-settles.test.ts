/**
 * A closed ACP connection must settle every request still waiting on it.
 *
 * The bug being pinned: `@agentclientprotocol/sdk@0.16.1` kept each outgoing request's resolver
 * in a map that only an inbound response could clear. When the transport failed for good (the
 * daemon answered every POST with a 502 because the harness process could not start), the
 * transport errored the readable stream, the SDK's reader loop threw into nothing (an
 * `unhandledRejection`), and the request stayed pending forever. The turn that awaited it sat in
 * `probe_capabilities -> create_session` heartbeating `running=true` with no deadline.
 *
 * The patch (patches/@agentclientprotocol__sdk@0.16.1.patch) rejects every pending request with
 * the transport's error when the connection closes, and rejects a request sent after that at
 * once, which is what the SDK's later majors do.
 *
 * Run: pnpm exec vitest run tests/unit/acp-connection-close-settles.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { AcpHttpClient, AcpHttpError } from "acp-http-client";

const HUNG = Symbol("hung");

/** Resolve to HUNG instead of waiting forever, so a regression fails fast rather than timing out. */
async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | typeof HUNG> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof HUNG>((resolve) => {
        timer = setTimeout(() => resolve(HUNG), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the sandbox-agent daemon answers when it cannot spawn the harness process. */
function agentProcessMissing(): Response {
  return new Response(
    JSON.stringify({
      type: "urn:sandbox-agent:error:stream_error",
      title: "Stream Error",
      status: 502,
      detail: "stream error: failed to start agent process: No such file or directory (os error 2)",
    }),
    { status: 502, headers: { "content-type": "application/problem+json" } },
  );
}

function clientWith(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): AcpHttpClient {
  return new AcpHttpClient({
    baseUrl: "http://example.invalid",
    fetch: fetchImpl as unknown as typeof fetch,
  });
}

function transportOf(client: AcpHttpClient): { failReadable: (error: unknown) => void } {
  return (client as unknown as { transport: { failReadable: (error: unknown) => void } })
    .transport;
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

describe("a failed ACP transport settles the requests waiting on it", () => {
  it("rejects initialize with the daemon's error when every write fails", async () => {
    let posts = 0;
    const client = clientWith((async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts += 1;
      return agentProcessMissing();
    }) as never);

    const outcome = await settleWithin(
      client.initialize().then(
        () => "resolved" as const,
        (error: unknown) => error,
      ),
      5_000,
    );

    assert.notEqual(outcome, HUNG, "initialize must not wait forever on a dead transport");
    assert.ok(outcome instanceof AcpHttpError, `expected AcpHttpError, got ${String(outcome)}`);
    assert.equal(outcome.status, 502);
    assert.equal(posts, 3, "the write path still retries its bounded budget first");
  });

  it("rejects a request already in flight when the stream fails under it", async () => {
    // The POST is accepted (202, the answer would arrive over SSE), then the stream dies.
    const client = clientWith(async () => new Response(null, { status: 202 }));
    const pending = client.newSession({ cwd: "/work", mcpServers: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const lost = new Error("sse stream lost");
    transportOf(client).failReadable(lost);

    const outcome = await settleWithin(
      pending.then(
        () => "resolved" as const,
        (error: unknown) => error,
      ),
      2_000,
    );
    assert.equal(outcome, lost);
  });

  it("rejects a request sent after the connection closed instead of parking it", async () => {
    const client = clientWith(async () => new Response(null, { status: 202 }));
    const lost = new Error("sse stream lost");
    transportOf(client).failReadable(lost);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const outcome = await settleWithin(
      client.newSession({ cwd: "/work", mcpServers: [] }).then(
        () => "resolved" as const,
        (error: unknown) => error,
      ),
      2_000,
    );
    assert.notEqual(outcome, HUNG);
    assert.ok(outcome instanceof Error);
  });

  it("does not leak the stream failure as an unhandled rejection", async () => {
    const client = clientWith(async () => agentProcessMissing());
    await client.initialize().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  });
});
