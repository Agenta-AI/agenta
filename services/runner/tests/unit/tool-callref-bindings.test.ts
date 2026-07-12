/**
 * Unit tests for callRef callback execution through the host relay.
 *
 * These pin the test_run runner contract: contextBindings are applied only in the callRef
 * branch, timeoutMs reaches /tools/call, and runContext.run.kind is forwarded as
 * x-agenta-run-kind. (The relay carries execution only; permission gates ride the ACP plane.)
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

import type { ResolvedToolSpec, RunContext } from "../../src/protocol.ts";
import {
  localRelayHost,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";

const ENDPOINT = "https://agenta.example/api/tools/call";
const RUN_CONTEXT: RunContext = {
  run: { kind: "test" },
  workflow: { variant: { id: "own-variant" } },
};

interface CapturedFetch {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout;

afterEach(() => {
  globalThis.fetch = realFetch;
  AbortSignal.timeout = realTimeout;
});

function stubFetch(body = "ok"): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return calls;
}

async function relayOnce(input: {
  spec: ResolvedToolSpec;
  args: unknown;
  runContext?: RunContext;
  expectResponse?: boolean;
  stopWhen?: () => boolean;
}): Promise<RelayResponse | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-callref-relay-"));
  try {
    const id = "call-1";
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [input.spec],
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      input.runContext,
    );
    // Written AFTER startToolRelay: the loop's first successful list (issued
    // synchronously inside startToolRelay) is the orphan snapshot, and a request
    // already present there is cleared as pre-turn residue instead of executed.
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({
        toolName: input.spec.name,
        toolCallId: id,
        args: input.args,
      }),
    );
    const resPath = join(dir, `${id}.res.json`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(resPath)) {
      if (input.stopWhen?.()) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await relay.stop();
    const wroteResponse = existsSync(resPath);
    if (input.expectResponse === false) {
      assert.equal(
        wroteResponse,
        false,
        "the relay did not write a response file",
      );
      return undefined;
    }
    assert.ok(wroteResponse, "the relay wrote a response file");
    return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function callRefSpec(
  overrides: Partial<ResolvedToolSpec> = {},
): ResolvedToolSpec {
  return {
    name: "test_run",
    kind: "callback",
    callRef: "tools.agenta.test_run",
    contextBindings: {
      "target.workflow_variant_id": "$ctx.workflow.variant.id",
    },
    timeoutMs: 120000,
    ...overrides,
  };
}

describe("startToolRelay callRef context bindings", () => {
  it("applies bindings in the callRef branch and lets bindings override model args", async () => {
    const calls = stubFetch();

    const res = await relayOnce({
      spec: callRefSpec(),
      args: {
        target: { workflow_variant_id: "model-variant" },
        inputs: { city: "Berlin" },
      },
      runContext: RUN_CONTEXT,
    });

    assert.equal(res?.ok, true);
    assert.equal(calls.length, 1);
    const posted = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(posted.data.function, {
      name: "tools.agenta.test_run",
      arguments: {
        target: { workflow_variant_id: "own-variant" },
        inputs: { city: "Berlin" },
      },
    });
  });

  it("fails closed when a binding token cannot be resolved, without fetching", async () => {
    const calls = stubFetch();

    const res = await relayOnce({
      spec: callRefSpec(),
      args: { target: { workflow_variant_id: "model-variant" } },
      runContext: { run: { kind: "test" } },
    });

    assert.equal(res?.ok, false);
    assert.match(
      res?.error ?? "",
      /missing run-context value for tool binding 'target\.workflow_variant_id'/,
    );
    assert.equal(calls.length, 0);
  });

  it("binds context values on execution", async () => {
    const calls = stubFetch();
    const args = {
      target: { workflow_variant_id: "model-variant" },
      inputs: { city: "Berlin" },
    };

    const res = await relayOnce({
      spec: callRefSpec(),
      args,
      runContext: RUN_CONTEXT,
    });

    assert.equal(res?.ok, true);
    assert.equal(calls.length, 1);
    const posted = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(posted.data.function.arguments, {
      target: { workflow_variant_id: "own-variant" },
      inputs: { city: "Berlin" },
    });
  });

  it("forwards run kind only when runContext.run.kind is set", async () => {
    const calls = stubFetch();
    await relayOnce({
      spec: callRefSpec(),
      args: {},
      runContext: RUN_CONTEXT,
    });
    await relayOnce({
      spec: callRefSpec({ contextBindings: undefined }),
      args: {},
    });

    assert.equal(calls.length, 2);
    assert.equal(
      (calls[0].init.headers as Record<string, string>)["x-agenta-run-kind"],
      "test",
    );
    assert.equal(
      (calls[1].init.headers as Record<string, string>)["x-agenta-run-kind"],
      undefined,
    );
  });

  it("uses per-spec timeoutMs plus grace for callRef fetches and falls back to the global default", async () => {
    stubFetch();
    const timeoutCalls: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      timeoutCalls.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout;

    await relayOnce({ spec: callRefSpec(), args: {}, runContext: RUN_CONTEXT });
    await relayOnce({
      spec: callRefSpec({ contextBindings: undefined, timeoutMs: undefined }),
      args: {},
    });

    assert.deepEqual(timeoutCalls, [130000, 30000]);
  });

  it("ignores spec-level contextBindings on the direct call descriptor branch", async () => {
    const calls = stubFetch("direct-ok");
    const spec = callRefSpec({
      callRef: undefined,
      call: { method: "POST", path: "/api/tools/direct" },
      contextBindings: {
        "target.workflow_variant_id": "$ctx.workflow.variant.id",
      },
    });

    const res = await relayOnce({
      spec,
      args: { target: { workflow_variant_id: "model-variant" } },
      runContext: RUN_CONTEXT,
    });

    assert.equal(res?.ok, true);
    assert.equal(res?.text, "direct-ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://agenta.example/api/tools/direct");
    assert.equal(
      (calls[0].init.headers as Record<string, string>)["x-agenta-run-kind"],
      "test",
    );
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      target: { workflow_variant_id: "model-variant" },
    });
  });
});
