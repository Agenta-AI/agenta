/**
 * Unit tests for the pnpm-patched retry-with-backoff in acp-http-client's write path
 * (patches/acp-http-client@0.4.2.patch). A transient write failure must be retried instead
 * of tearing down the whole ACP connection via failReadable.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/acp-http-client-retry.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  AcpHttpClient,
  AcpHttpError,
  isRetryableAcpWriteError,
} from "acp-http-client";
import { createAcpFetch } from "../../src/engines/sandbox_agent/acp-fetch.ts";

/** Reach the private StreamableHttpAcpTransport instance backing an AcpHttpClient. */
function transportOf(client: AcpHttpClient): {
  postMessage: (url: string, headers: Headers, message: unknown) => Promise<void>;
  readableController: { error: (e: unknown) => void; close: () => void } | null;
  closed: boolean;
  failReadable: (error: unknown) => void;
} {
  return (client as unknown as { transport: ReturnType<typeof transportOf> }).transport;
}

function socketError(message = "other side closed"): Error {
  const err = new Error(message);
  err.name = "SocketError";
  return err;
}

/** failReadable() errors the SDK's own background reader loop, which has no catch handler. */
async function withSuppressedReaderRejection<T>(fn: () => Promise<T>): Promise<T> {
  const onUnhandledRejection = () => {};
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    const result = await fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return result;
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
}

describe("isRetryableAcpWriteError", () => {
  it("classifies socket/network errors as retryable", () => {
    assert.equal(isRetryableAcpWriteError(socketError()), true);
    assert.equal(isRetryableAcpWriteError(Object.assign(new Error("boom"), { code: "ECONNRESET" })), true);
    assert.equal(isRetryableAcpWriteError(Object.assign(new Error("boom"), { code: "ECONNREFUSED" })), true);
    assert.equal(isRetryableAcpWriteError(Object.assign(new Error("boom"), { code: "ETIMEDOUT" })), true);
    assert.equal(isRetryableAcpWriteError(Object.assign(new Error("boom"), { code: "EPIPE" })), true);
    assert.equal(isRetryableAcpWriteError(new Error("fetch failed")), true);
    assert.equal(isRetryableAcpWriteError(Object.assign(new Error("boom"), { code: "UND_ERR_SOCKET" })), true);
  });

  it("classifies a wrapped cause the same as a top-level match", () => {
    const wrapped = new Error("fetch failed");
    (wrapped as unknown as { cause: unknown }).cause = Object.assign(new Error("x"), {
      code: "ECONNRESET",
    });
    assert.equal(isRetryableAcpWriteError(wrapped), true);
  });

  it("classifies 5xx/408/429 AcpHttpError as retryable", () => {
    const res = new Response(null, { status: 503 });
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(503, undefined, res)), true);
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(500, undefined, res)), true);
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(408, undefined, res)), true);
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(429, undefined, res)), true);
  });

  it("classifies 4xx AcpHttpError (other than 408/429) as NOT retryable", () => {
    const res = new Response(null, { status: 403 });
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(400, undefined, res)), false);
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(401, undefined, res)), false);
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(403, undefined, res)), false);
    assert.equal(isRetryableAcpWriteError(new AcpHttpError(404, undefined, res)), false);
  });

  it("classifies a JSON parse error as NOT retryable", () => {
    let error: unknown;
    try {
      JSON.parse("not json");
    } catch (e) {
      error = e;
    }
    assert.equal(isRetryableAcpWriteError(error), false);
  });
});

describe("postMessage retry-with-backoff", () => {
  it("retries a transient socket error and does not call failReadable when a later attempt succeeds", async () => {
    let calls = 0;
    const client = new AcpHttpClient({
      baseUrl: "http://example.invalid",
      fetch: (async () => {
        calls += 1;
        if (calls < 3) throw socketError();
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
    });
    const transport = transportOf(client);
    let failReadableCalled = false;
    const originalFailReadable = transport.failReadable.bind(transport);
    transport.failReadable = (error: unknown) => {
      failReadableCalled = true;
      originalFailReadable(error);
    };

    await transport.postMessage(
      "http://example.invalid/v1/rpc",
      new Headers(),
      { jsonrpc: "2.0", id: 1, method: "noop" },
    );

    assert.equal(calls, 3, "expected exactly 2 failures then a success (3 attempts)");
    assert.equal(failReadableCalled, false);
    assert.equal(transport.closed, false);
  });

  it("does not retry a 4xx AcpHttpError and fails immediately via failReadable", async () => {
    let calls = 0;
    const client = new AcpHttpClient({
      baseUrl: "http://example.invalid",
      fetch: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ type: "about:blank", title: "nope", status: 403 }), {
          status: 403,
        });
      }) as unknown as typeof fetch,
    });
    const transport = transportOf(client);
    let failReadableError: unknown;
    const originalFailReadable = transport.failReadable.bind(transport);
    transport.failReadable = (error: unknown) => {
      failReadableError = error;
      originalFailReadable(error);
    };

    await withSuppressedReaderRejection(() =>
      transport.postMessage(
        "http://example.invalid/v1/rpc",
        new Headers(),
        { jsonrpc: "2.0", id: 1, method: "noop" },
      ),
    );

    assert.equal(calls, 1, "a non-retryable 4xx must not be retried");
    assert.ok(failReadableError instanceof AcpHttpError);
    assert.equal((failReadableError as AcpHttpError).status, 403);
    assert.equal(transport.closed, true);
  });

  it("bounds the retry budget and gives up after 3 attempts", async () => {
    let calls = 0;
    const client = new AcpHttpClient({
      baseUrl: "http://example.invalid",
      fetch: (async () => {
        calls += 1;
        throw socketError();
      }) as unknown as typeof fetch,
    });
    const transport = transportOf(client);
    let failReadableCalled = false;
    const originalFailReadable = transport.failReadable.bind(transport);
    transport.failReadable = (error: unknown) => {
      failReadableCalled = true;
      originalFailReadable(error);
    };

    await withSuppressedReaderRejection(() =>
      transport.postMessage(
        "http://example.invalid/v1/rpc",
        new Headers(),
        { jsonrpc: "2.0", id: 1, method: "noop" },
      ),
    );

    assert.equal(calls, 3, "retry budget must be bounded, not infinite");
    assert.equal(failReadableCalled, true);
    assert.equal(transport.closed, true);
  });

  it("stops retrying without calling failReadable once the client has been closed", async () => {
    let calls = 0;
    const client = new AcpHttpClient({
      baseUrl: "http://example.invalid",
      fetch: (async () => {
        calls += 1;
        throw socketError();
      }) as unknown as typeof fetch,
    });
    const transport = transportOf(client);
    let failReadableCalled = false;
    transport.failReadable = () => {
      failReadableCalled = true;
    };

    const pending = transport.postMessage(
      "http://example.invalid/v1/rpc",
      new Headers(),
      { jsonrpc: "2.0", id: 1, method: "noop" },
    );
    transport.closed = true;
    await pending;

    assert.equal(failReadableCalled, false);
  });
});

describe("session/prompt is never resent once it may have arrived", () => {
  const prompt = { jsonrpc: "2.0", id: 1, method: "session/prompt" };

  /** Post `message` through a client whose fetch always fails with `error`; returns the attempts. */
  async function attemptsFor(message: unknown, error: Error): Promise<number> {
    let calls = 0;
    const client = new AcpHttpClient({
      baseUrl: "http://example.invalid",
      fetch: (async () => {
        calls += 1;
        throw error;
      }) as unknown as typeof fetch,
    });
    await withSuppressedReaderRejection(() =>
      transportOf(client).postMessage("http://example.invalid/v1/rpc", new Headers(), message),
    );
    return calls;
  }

  it("does not retry a prompt after a socket error", async () => {
    assert.equal(await attemptsFor(prompt, socketError()), 1);
  });

  it("does not retry a prompt after a 503", async () => {
    let calls = 0;
    const client = new AcpHttpClient({
      baseUrl: "http://example.invalid",
      fetch: (async () => {
        calls += 1;
        return new Response("", { status: 503 });
      }) as unknown as typeof fetch,
    });
    await withSuppressedReaderRejection(() =>
      transportOf(client).postMessage("http://example.invalid/v1/rpc", new Headers(), prompt),
    );
    assert.equal(calls, 1);
  });

  it("retries a prompt when the connection was refused, because it never arrived", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    assert.equal(await attemptsFor(prompt, refused), 3);
  });

  it("still retries other methods after a socket error", async () => {
    assert.equal(await attemptsFor({ jsonrpc: "2.0", id: 2, method: "session/cancel" }, socketError()), 3);
  });

  it("sends one prompt when the real transport times out waiting for the response", async () => {
    let promptPosts = 0;
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        promptPosts += 1;
        return; // The turn is still running, so the response never starts.
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS = "200";
    try {
      const client = new AcpHttpClient({
        baseUrl: `http://127.0.0.1:${port}`,
        fetch: createAcpFetch(),
      });
      await withSuppressedReaderRejection(async () => {
        await assert.rejects(
          client.clientSideConnection.prompt({ sessionId: "s", prompt: [] }),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      assert.equal(promptPosts, 1);
      assert.equal(transportOf(client).closed, true);
    } finally {
      delete process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS;
      server.closeAllConnections();
      server.close();
    }
  }, 20_000);
});
