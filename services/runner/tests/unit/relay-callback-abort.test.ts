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
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import {
  localRelayHost,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import { fixedToolCallback } from "../utils/tool-callback.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

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
    let fetchStarted = false;
    let fetchSignal: AbortSignal | undefined;
    // A callback that never answers on its own: only an abort can end it.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      fetchStarted = true;
      fetchSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new Error("aborted")),
        );
      });
    }) as typeof fetch;

    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-abort-"));
    const turn = new AbortController();
    try {
      const relay = startToolRelay(
        localRelayHost(),
        dir,
        [SPEC],
        fixedToolCallback({
          endpoint: "https://agenta.example/api/tools/call",
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
      while (Date.now() < deadline && !fetchStarted) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(fetchStarted, "the relay started the callback");
      assert.ok(fetchSignal, "the callback fetch carries a signal");

      const stoppedAt = Date.now();
      turn.abort();
      await relay.stop();
      const waited = Date.now() - stoppedAt;
      assert.ok(waited < 1000, `stop() drained in ${waited} ms, expected under 1 s`);

      const resPath = join(dir, "call-1.res.json");
      assert.ok(await waitFor(resPath, 1000), "the relay answered the call");
      const res = JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
      assert.equal(res.ok, false, "an aborted call answers as an error");
    } finally {
      turn.abort();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
