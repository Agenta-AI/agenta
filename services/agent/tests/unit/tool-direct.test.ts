/**
 * Unit tests for direct-call tools (tools/direct.ts) and the live dispatch branch that uses it
 * (tools/relay.ts `startToolRelay` -> `executeRelayedTool`). The symmetric `tools/dispatch.ts`
 * `runResolvedTool` host-direct branch is deferred (see direct.ts), so it is not exercised here.
 *
 * A resolved callback tool can carry a `call` descriptor; when it does the runner calls the
 * Agenta endpoint directly instead of routing through /tools/call. These tests cover:
 *  - assembleBody: args_into deep-set, the fixed-wins overlay, the root merge, the run-context
 *    binding, and prototype-pollution-safe assignment (including nested unsafe keys).
 *  - directCallUrl (the SSRF guard): method allowlist, the mount-agnostic absolute-path rule,
 *    traversal / protocol-relative / absolute-URL rejection, origin binding (host-lock) to the
 *    run's callback endpoint, and failing closed when the callback mount cannot be derived.
 *  - callDirect: the redirect:manual round-trip and the GET-with-body fail-fast guard.
 *  - the relay branch (startToolRelay -> executeRelayedTool) with FAKE `call` specs and a mocked
 *    global fetch.
 *
 * No network and no harness: `globalThis.fetch` is stubbed per test and restored after.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-direct.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assembleBody,
  callDirect,
  deepDelete,
  deepMerge,
  deepSet,
  directCallUrl,
  resolveCtxToken,
  type DirectCall,
} from "../../src/tools/direct.ts";
import {
  localRelayHost,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import type { ResolvedToolSpec, RunContext } from "../../src/protocol.ts";

// A fake run context (direct-call tools, Phase 3a). The keys are the snake_case binding namespace
// a `call.context` value (`"$ctx.<dotted.path>"`) addresses.
const RUN_CONTEXT: RunContext = {
  workflow: {
    variant: { id: "own-variant" },
    revision: { id: "rev_self" },
    is_draft: false,
  },
  trace: { trace_id: "trace-self", span_id: "span-self" },
};

const ENDPOINT = "https://agenta.example/api/tools/call";

/** One captured fetch call. */
interface CapturedFetch {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace global fetch with a stub that records the call and returns `body`. */
function stubFetch(body: string, ok = true, status = 200): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status: ok ? status : status >= 400 ? status : 500 });
  }) as typeof fetch;
  return calls;
}

// ---------------------------------------------------------------------------
// assembleBody
// ---------------------------------------------------------------------------

describe("assembleBody", () => {
  it("deep-sets the model args at args_into", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/workflows/invoke",
      args_into: "data.inputs",
    };
    const body = assembleBody(call, { city: "Paris" });
    assert.deepEqual(body, { data: { inputs: { city: "Paris" } } });
  });

  it("merges the model args at the root when args_into is absent", () => {
    const call: DirectCall = { method: "POST", path: "/api/workflows/query" };
    const body = assembleBody(call, { flags: { is_draft: true } });
    assert.deepEqual(body, { flags: { is_draft: true } });
  });

  it("overlays the reference invoke: args at data.inputs, fixed revision at the root", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/workflows/invoke",
      body: { references: { workflow_revision: { id: "rev_abc123" } } },
      args_into: "data.inputs",
    };
    const body = assembleBody(call, { city: "Paris" });
    assert.deepEqual(body, {
      data: { inputs: { city: "Paris" } },
      references: { workflow_revision: { id: "rev_abc123" } },
    });
  });

  it("lets the server-fixed body win over a colliding model arg (no retargeting)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/workflows/revisions/commit",
      // self-targeting fixed field: the model passes a different id but cannot override it.
      body: { workflow_variant_id: "own-variant" },
    };
    const body = assembleBody(call, {
      workflow_variant_id: "someone-elses",
      parameters: { temperature: 0.2 },
    });
    assert.equal(body.workflow_variant_id, "own-variant");
    assert.deepEqual(body.parameters, { temperature: 0.2 });
  });

  it("fixed body wins on a nested collision, too", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/workflows/invoke",
      body: { data: { inputs: { locked: "server" } } },
      args_into: "data.inputs",
    };
    const body = assembleBody(call, { locked: "model", extra: 1 });
    assert.deepEqual(body, {
      data: { inputs: { locked: "server", extra: 1 } },
    });
  });

  it("drops non-object args when there is no args_into (nowhere safe at the root)", () => {
    const call: DirectCall = { method: "POST", path: "/api/x" };
    assert.deepEqual(assembleBody(call, "a string"), {});
    assert.deepEqual(assembleBody(call, undefined), {});
  });

  it("is prototype-pollution-safe via args_into", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      args_into: "__proto__.polluted",
    };
    assert.throws(() => assembleBody(call, true), /unsafe path segment '__proto__'/);
    assert.equal(({} as any).polluted, undefined);
  });

  it("is prototype-pollution-safe via a body key", () => {
    // JSON.parse makes a real OWN "__proto__" key (an object literal would set the prototype).
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      body: JSON.parse('{"__proto__": {"polluted": true}}'),
    };
    const body = assembleBody(call, { a: 1 });
    assert.equal((body as any).polluted, undefined);
    assert.equal(({} as any).polluted, undefined);
  });

  it("strips a nested unsafe key from the model args at the root", () => {
    // Untrusted model args with a NESTED "__proto__" must be sanitized at every level, not just
    // the top. JSON.parse makes the "__proto__" an own key (an object literal would set the proto).
    const call: DirectCall = { method: "POST", path: "/api/x" };
    const args = JSON.parse('{"nested": {"__proto__": {"polluted": true}, "ok": 1}}');
    const body = assembleBody(call, args);
    assert.deepEqual(body, { nested: { ok: 1 } });
    assert.equal(({} as any).polluted, undefined);
  });

  it("strips a nested unsafe key from the model args at args_into", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      args_into: "data.inputs",
    };
    const args = JSON.parse('{"__proto__": {"polluted": true}, "city": "Paris"}');
    const body = assembleBody(call, args);
    assert.deepEqual(body, { data: { inputs: { city: "Paris" } } });
    assert.equal(({} as any).polluted, undefined);
  });
});

// ---------------------------------------------------------------------------
// assembleBody — run-context binding (call.context, direct-call tools Phase 3a)
// ---------------------------------------------------------------------------

describe("assembleBody context binding", () => {
  it("binds a $ctx value from the run context, deep-set at the mapped path", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/annotations/",
      context: { "references.trace.id": "$ctx.trace.trace_id" },
    };
    const body = assembleBody(call, { note: "hi" }, RUN_CONTEXT);
    assert.deepEqual(body, {
      note: "hi",
      references: { trace: { id: "trace-self" } },
    });
  });

  it("handles a missing run-context key safely (the field stays unset)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      context: { latest: "$ctx.workflow.revision.missing" }, // not in RUN_CONTEXT
    };
    const body = assembleBody(call, { a: 1 }, RUN_CONTEXT);
    assert.deepEqual(body, { a: 1 });
    assert.ok(!("latest" in body));
  });

  it("clears a colliding model arg when the bound key is missing (model-invisible)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      // The bound field is owned by run context; a missing key must leave it ABSENT, never let the
      // model's value survive.
      context: { workflow_variant_id: "$ctx.workflow.revision.missing" },
    };
    const body = assembleBody(
      call,
      { workflow_variant_id: "someone-elses", keep: 1 },
      RUN_CONTEXT,
    );
    assert.ok(!("workflow_variant_id" in body));
    assert.equal(body.keep, 1);
  });

  it("clears a colliding static body field when the bound key is missing", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      body: { trace_id: "from-body" },
      context: { trace_id: "$ctx.trace.missing" },
    };
    const body = assembleBody(call, {}, RUN_CONTEXT);
    assert.ok(!("trace_id" in body));
  });

  it("handles an absent run context safely (no binding applied)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      context: { "trace.trace_id": "$ctx.trace.trace_id" },
    };
    // No runContext argument at all (the Phase-2 call shape): the binding is simply skipped.
    assert.deepEqual(assembleBody(call, { a: 1 }), { a: 1 });
  });

  it("lets a bound field win over a colliding model arg (the model cannot override it)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/workflows/revisions/commit",
      context: { workflow_variant_id: "$ctx.workflow.variant.id" },
    };
    const body = assembleBody(
      call,
      { workflow_variant_id: "someone-elses", parameters: { temperature: 0.2 } },
      RUN_CONTEXT,
    );
    // Bound to the run's OWN variant, not the model's attempt.
    assert.equal(body.workflow_variant_id, "own-variant");
    assert.deepEqual(body.parameters, { temperature: 0.2 });
  });

  it("lets a bound field win over a static body field (context is filled last)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      body: { trace_id: "from-body" },
      context: { trace_id: "$ctx.trace.trace_id" },
    };
    const body = assembleBody(call, {}, RUN_CONTEXT);
    assert.equal(body.trace_id, "trace-self");
  });

  it("skips a malformed context token (one without the $ctx. prefix)", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      context: { trace_id: "trace.trace_id" }, // missing the $ctx. prefix -> untrusted, skipped
    };
    const body = assembleBody(call, { a: 1 }, RUN_CONTEXT);
    assert.deepEqual(body, { a: 1 });
  });

  it("is prototype-pollution-safe on the bound body path", () => {
    const call: DirectCall = {
      method: "POST",
      path: "/api/x",
      context: { "__proto__.polluted": "$ctx.trace.trace_id" },
    };
    assert.throws(
      () => assembleBody(call, { a: 1 }, RUN_CONTEXT),
      /unsafe path segment '__proto__'/,
    );
    assert.equal(({} as any).polluted, undefined);
  });
});

describe("resolveCtxToken", () => {
  it("navigates a dotted path against the run context", () => {
    assert.equal(
      resolveCtxToken(RUN_CONTEXT, "$ctx.workflow.variant.id"),
      "own-variant",
    );
    assert.equal(resolveCtxToken(RUN_CONTEXT, "$ctx.workflow.is_draft"), false);
  });

  it("returns undefined for a missing key, a malformed token, or no run context", () => {
    assert.equal(
      resolveCtxToken(RUN_CONTEXT, "$ctx.workflow.variant.missing"),
      undefined,
    );
    assert.equal(resolveCtxToken(RUN_CONTEXT, "workflow.variant.id"), undefined);
    assert.equal(resolveCtxToken(undefined, "$ctx.trace.trace_id"), undefined);
  });

  it("rejects unsafe / inherited segments in the token (prototype-safe at the source)", () => {
    // The token is untrusted: it must never walk the prototype chain out of the run-context blob,
    // even though `__proto__`/`constructor` resolve on any object.
    assert.equal(resolveCtxToken(RUN_CONTEXT, "$ctx.workflow.__proto__"), undefined);
    assert.equal(
      resolveCtxToken(RUN_CONTEXT, "$ctx.__proto__.polluted"),
      undefined,
    );
    assert.equal(
      resolveCtxToken(RUN_CONTEXT, "$ctx.constructor.name"),
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// deepSet / deepMerge primitives
// ---------------------------------------------------------------------------

describe("deepSet / deepMerge", () => {
  it("deepSet rejects an empty path segment", () => {
    assert.throws(() => deepSet({}, "a..b", 1), /invalid empty segment/);
  });

  it("deepSet replaces a non-object intermediate", () => {
    const target: Record<string, unknown> = { a: 5 };
    deepSet(target, "a.b", 1);
    assert.deepEqual(target, { a: { b: 1 } });
  });

  it("deepMerge has the overlay win and does not mutate inputs", () => {
    const base = { a: { x: 1 }, keep: 1 };
    const overlay = { a: { y: 2 }, keep: 9 };
    const out = deepMerge(base, overlay);
    assert.deepEqual(out, { a: { x: 1, y: 2 }, keep: 9 });
    assert.deepEqual(base, { a: { x: 1 }, keep: 1 }, "base is untouched");
  });

  it("deepMerge strips a nested unsafe key even when the base side is not an object", () => {
    // The overlay subtree lands on a non-object base key, so it cannot merge onto an existing
    // subtree — it must still be sanitized through deepMerge rather than assigned wholesale.
    const overlay = JSON.parse('{"a": {"__proto__": {"polluted": true}, "ok": 1}}');
    const out = deepMerge({ a: 5 }, overlay);
    assert.deepEqual(out, { a: { ok: 1 } });
    assert.equal(({} as any).polluted, undefined);
  });

  it("deepDelete removes a nested leaf and no-ops a missing parent, proto-safely", () => {
    const target: Record<string, unknown> = { a: { b: 1, c: 2 }, keep: 3 };
    deepDelete(target, "a.b");
    assert.deepEqual(target, { a: { c: 2 }, keep: 3 });
    deepDelete(target, "x.y.z"); // missing parent -> no-op, no throw
    assert.deepEqual(target, { a: { c: 2 }, keep: 3 });
    assert.throws(() => deepDelete(target, "__proto__.polluted"), /unsafe path segment/);
  });
});

// ---------------------------------------------------------------------------
// directCallUrl (SSRF guard)
// ---------------------------------------------------------------------------

describe("directCallUrl", () => {
  it("joins the callback origin with the /api path", () => {
    const url = directCallUrl(ENDPOINT, {
      method: "POST",
      path: "/api/workflows/invoke",
    });
    assert.equal(url, "https://agenta.example/api/workflows/invoke");
  });

  it("preserves a non-default port from the callback origin", () => {
    const url = directCallUrl("http://127.0.0.1:8000/api/tools/call", {
      method: "GET",
      path: "/api/workflows/abc",
    });
    assert.equal(url, "http://127.0.0.1:8000/api/workflows/abc");
  });

  it("keeps a query string", () => {
    const url = directCallUrl(ENDPOINT, {
      method: "GET",
      path: "/api/tools/catalog/integrations?search=github",
    });
    assert.equal(
      url,
      "https://agenta.example/api/tools/catalog/integrations?search=github",
    );
  });

  it("rejects a disallowed method", () => {
    assert.throws(
      () => directCallUrl(ENDPOINT, { method: "DELETE" as any, path: "/api/x" }),
      /method 'DELETE' is not allowed/,
    );
  });

  it("accepts a path on a non-/api mount (OSS self-host at the origin root)", () => {
    // The callback carries no /api prefix, so the mount is empty and the host-lock is the only
    // boundary — the API lives at the origin root on this deployment.
    const url = directCallUrl("http://host:8000/tools/call", {
      method: "POST",
      path: "/workflows/invoke",
    });
    assert.equal(url, "http://host:8000/workflows/invoke");
  });

  it("normalizes a trailing slash on the callback endpoint before deriving the mount", () => {
    const url = directCallUrl("https://agenta.example/api/tools/call/", {
      method: "POST",
      path: "/api/workflows/invoke",
    });
    assert.equal(url, "https://agenta.example/api/workflows/invoke");
  });

  it("fails closed when the callback path does not end with /tools/call", () => {
    // An unexpected callback shape would derive an empty mount and silently widen the guard to any
    // same-origin path; reject it instead.
    assert.throws(
      () =>
        directCallUrl("https://agenta.example/api/health", {
          method: "POST",
          path: "/api/workflows/invoke",
        }),
      /cannot derive Agenta API mount from callback endpoint/,
    );
  });

  it("rejects a same-origin path outside the callback's mount", () => {
    assert.throws(
      () => directCallUrl(ENDPOINT, { method: "POST", path: "/secrets" }),
      /is outside the Agenta API mount '\/api'/,
    );
  });

  it("rejects a percent-encoded traversal that normalizes out of the mount", () => {
    // `/api/%2e%2e/admin` URL-normalizes to `/admin`: the literal `..` check misses it, but the
    // mount confinement (after resolution) rejects it.
    assert.throws(
      () => directCallUrl(ENDPOINT, { method: "POST", path: "/api/%2e%2e/admin" }),
      /is outside the Agenta API mount '\/api'/,
    );
  });

  it("rejects an absolute URL as the path", () => {
    assert.throws(
      () =>
        directCallUrl(ENDPOINT, {
          method: "POST",
          path: "https://evil.example/api/x",
        }),
      /must be an absolute path starting with a single '\/'/,
    );
  });

  it("rejects a protocol-relative path", () => {
    assert.throws(
      () => directCallUrl(ENDPOINT, { method: "POST", path: "//evil.example/api/x" }),
      /must be an absolute path starting with a single '\/'/,
    );
  });

  it("rejects a literal traversal path", () => {
    assert.throws(
      () => directCallUrl(ENDPOINT, { method: "POST", path: "/api/../admin" }),
      /is not a safe relative path/,
    );
  });

  it("rejects a callback endpoint with no usable origin", () => {
    assert.throws(
      () => directCallUrl("not a url", { method: "POST", path: "/api/x" }),
      /cannot derive Agenta origin/,
    );
  });
});

// ---------------------------------------------------------------------------
// callDirect (HTTP round-trip)
// ---------------------------------------------------------------------------

describe("callDirect", () => {
  it("fails fast on a GET with a non-empty body (inputs would be silently dropped)", async () => {
    // fetch forbids a GET body, so a GET descriptor with assembled inputs must not run — it would
    // execute without them. The guard throws before fetch is ever called.
    const calls = stubFetch("never");
    await assert.rejects(
      callDirect("GET", "https://agenta.example/api/x", undefined, { city: "Paris" }),
      /GET cannot carry a request body/,
    );
    assert.equal(calls.length, 0, "fetch is never called");
  });

  it("allows a GET with an empty body", async () => {
    const calls = stubFetch("ok");
    const out = await callDirect("GET", "https://agenta.example/api/x", undefined, {});
    assert.equal(out, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.body, undefined, "no GET body is sent");
  });
});

// The reference-tool spec reused by the live dispatch tests below: a stored workflow invoked as
// a tool (args at data.inputs, the resolved revision baked into the fixed body).
const refSpec: ResolvedToolSpec = {
  name: "get_weather",
  kind: "callback",
  call: {
    method: "POST",
    path: "/api/workflows/invoke",
    body: { references: { workflow_revision: { id: "rev_abc123" } } },
    args_into: "data.inputs",
  },
};

// ---------------------------------------------------------------------------
// dispatch branch (startToolRelay -> executeRelayedTool, the LIVE host path)
//
// Both live call sites (the Pi extension and the internal tool MCP server) relay tool calls to
// the runner, so executeRelayedTool is where a direct call actually happens — on local and on
// Daytona. The sandbox sends only name + args; the host assembles the body, applies the SSRF
// guard, and makes the call. (The dispatch.ts `runResolvedTool` host-direct branch is the
// symmetric non-relay path; it is deferred — see the PR notes — because dispatch.ts is being
// rewritten by a parallel lane.)
// ---------------------------------------------------------------------------

/** Drive one tool call through the host relay loop and return the response the runner wrote. */
async function relayOnce(
  spec: ResolvedToolSpec,
  callback: { endpoint: string; authorization?: string },
  args: unknown,
  runContext?: RunContext,
): Promise<RelayResponse> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-direct-relay-"));
  try {
    const id = "call-1";
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({ toolName: spec.name, toolCallId: id, args }),
    );
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [spec],
      callback,
      "auto",
      runContext,
    );
    const resPath = join(dir, `${id}.res.json`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(resPath)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await relay.stop();
    assert.ok(existsSync(resPath), "the relay wrote a response file");
    return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("startToolRelay direct branch (host makes the call for the sandbox)", () => {
  it("makes the direct call host-side from a relayed name + args", async () => {
    const calls = stubFetch("relayed-direct-result");
    const res = await relayOnce(
      refSpec,
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      { city: "Berlin" },
    );

    assert.equal(res.ok, true);
    assert.equal(res.text, "relayed-direct-result");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://agenta.example/api/workflows/invoke");
    // Redirects are not auto-followed: a 3xx to another host would defeat the origin lock.
    assert.equal((calls[0].init as { redirect?: string }).redirect, "manual");
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      data: { inputs: { city: "Berlin" } },
      references: { workflow_revision: { id: "rev_abc123" } },
    });
  });

  it("binds run context into the relayed direct call, server-side (model never sets it)", async () => {
    const calls = stubFetch("ok");
    // A self-targeting platform tool: the model supplies only the payload; the runner binds the
    // run's own variant from runContext, and the model's attempt to retarget is overridden.
    const selfSpec: ResolvedToolSpec = {
      name: "update_self",
      kind: "callback",
      call: {
        method: "POST",
        path: "/api/workflows/revisions/commit",
        context: { workflow_variant_id: "$ctx.workflow.variant.id" },
      },
    };
    const res = await relayOnce(
      selfSpec,
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      { workflow_variant_id: "someone-elses", parameters: { temperature: 0.2 } },
      RUN_CONTEXT,
    );

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://agenta.example/api/workflows/revisions/commit");
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      workflow_variant_id: "own-variant", // bound to the run's own variant, not the model's
      parameters: { temperature: 0.2 },
    });
  });

  it("surfaces the SSRF-guard rejection as a relay error", async () => {
    stubFetch("never");
    const badSpec: ResolvedToolSpec = {
      name: "bad",
      kind: "callback",
      call: { method: "POST", path: "/secrets" },
    };
    const res = await relayOnce(
      badSpec,
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      {},
    );
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /is outside the Agenta API mount/);
  });

  it("returns a generic error on a non-2xx (no internal URL or upstream body leaks)", async () => {
    // The upstream responds 500 with a detailed body; the model must see only the status code,
    // never the resolved internal URL or the response body (those stay in the server log).
    stubFetch("INTERNAL stack trace + secret detail", false, 500);
    const res = await relayOnce(
      refSpec,
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      { city: "Berlin" },
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, "direct tool call failed: HTTP 500");
    assert.doesNotMatch(res.error ?? "", /agenta\.example/);
    assert.doesNotMatch(res.error ?? "", /stack trace|secret detail/);
  });
});
