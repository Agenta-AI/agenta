/**
 * A stopped turn ends a relayed callback at once.
 *
 * A reference tool carries a 30 minute `timeoutMs`, and `stop()` drains every in-flight call.
 * Before the turn's signal reached `callAgentaTool`, a Stop during a long child call kept the
 * relay (and the teardown that awaits it) waiting until the child answered or the limit fired.
 *
 * Run: pnpm exec vitest run tests/unit/relay-callback-abort.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import {
  localRelayHost,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import { fixedToolCallback } from "../utils/tool-callback.ts";

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  server = undefined;
});

/** A real /tools/call endpoint that never answers: only an abort can end the request. */
async function silentEndpoint(): Promise<{
  url: string;
  requests: IncomingMessage[];
  closed: () => boolean;
}> {
  const requests: IncomingMessage[] = [];
  let closed = false;
  server = createServer((req) => {
    requests.push(req);
    req.socket.on("close", () => {
      closed = true;
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/tools/call`,
    requests,
    closed: () => closed,
  };
}

const SPEC: ResolvedToolSpec = {
  name: "ask_child",
  kind: "callback",
  callRef: "workflow.variant.slow-child",
  permission: "allow",
  timeoutMs: 30 * 60_000,
};

async function waitFor(path: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !existsSync(path)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return existsSync(path);
}

describe("relayed callback and the turn's abort signal", () => {
  it("a stop ends a long reference call within a second", async () => {
    // A real HTTP endpoint, so the test runs the same transport a reference tool uses (its
    // 30 minute budget takes the long-wait dispatcher, not the global fetch).
    const endpoint = await silentEndpoint();

    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-abort-"));
    const turn = new AbortController();
    try {
      const relay = startToolRelay(
        localRelayHost(),
        dir,
        [SPEC],
        fixedToolCallback({
          endpoint: endpoint.url,
          authorization: "ApiKey secret",
        }),
        undefined,
        undefined,
        undefined,
        { signal: turn.signal },
      );
      await relay.ready;
      writeFileSync(
        join(dir, "call-1.req.json"),
        JSON.stringify({ toolName: SPEC.name, toolCallId: "call-1", args: {} }),
      );
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && endpoint.requests.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(
        endpoint.requests.length,
        1,
        "the relay started the callback",
      );

      const stoppedAt = Date.now();
      turn.abort();
      await relay.stop();
      const waited = Date.now() - stoppedAt;
      assert.ok(
        waited < 1000,
        `stop() drained in ${waited} ms, expected under 1 s`,
      );

      const resPath = join(dir, "call-1.res.json");
      assert.ok(await waitFor(resPath, 1000), "the relay answered the call");
      const res = JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
      assert.equal(res.ok, false, "an aborted call answers as an error");
      const closeDeadline = Date.now() + 1000;
      while (Date.now() < closeDeadline && !endpoint.closed()) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(endpoint.closed(), "the runner closed its /tools/call request");
    } finally {
      turn.abort();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
