/**
 * Unit tests for the ACP HTTP fetch dispatcher.
 *
 * HITL parks the ACP connection open while a human approves a tool; the default undici
 * `headersTimeout` would reap it (UND_ERR_HEADERS_TIMEOUT) and kill the parked + resume turns.
 * These tests pin that the ACP dispatcher defaults to a wide (not short, not disabled) timeout —
 * wide enough that an ordinary pause or run never trips it — and honors the env overrides,
 * including `0` to disable outright.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-acp-fetch.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createAcpDispatcher,
  createAcpFetch,
  withSandboxGoneReport,
} from "../../src/engines/sandbox_agent/acp-fetch.ts";

const envKeys = [
  "SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS",
  "SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS",
];
const previousEnv = new Map<string, string | undefined>();
for (const key of envKeys) previousEnv.set(key, process.env[key]);

afterEach(() => {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Read the undici Agent's resolved options off its private `Symbol(options)`. */
function agentOptions(dispatcher: object): Record<string, unknown> {
  const sym = Object.getOwnPropertySymbols(dispatcher).find(
    (s) => String(s) === "Symbol(options)",
  );
  assert.ok(sym, "undici Agent should expose Symbol(options)");
  return (dispatcher as Record<symbol, Record<string, unknown>>)[sym];
}

describe("createAcpDispatcher", () => {
  it("defaults headers/body timeouts wide so a parked HITL turn is not reaped", () => {
    delete process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS;
    delete process.env.SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS;
    const opts = agentOptions(createAcpDispatcher());
    // Wide enough that no ordinary pause or run trips it (see run-limits.ts for the total
    // deadline this backstops); not disabled outright, so a truly stuck connection still ends.
    assert.equal(opts.headersTimeout, 60 * 60_000);
    assert.equal(opts.bodyTimeout, 60 * 60_000);
  });

  it("honors a positive env override for the headers and body timeout", () => {
    process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS = "900000";
    process.env.SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS = "120000";
    const opts = agentOptions(createAcpDispatcher());
    assert.equal(opts.headersTimeout, 900000);
    assert.equal(opts.bodyTimeout, 120000);
  });

  it("honors an explicit 0 override to disable the timeout outright", () => {
    process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS = "0";
    const opts = agentOptions(createAcpDispatcher());
    assert.equal(opts.headersTimeout, 0);
  });

  it("falls back to the wide default for a non-numeric override", () => {
    process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS = "not-a-number";
    const opts = agentOptions(createAcpDispatcher());
    assert.equal(opts.headersTimeout, 60 * 60_000);
  });
});

describe("createAcpFetch", () => {
  it("returns a fetch bound to the long-timeout ACP dispatcher", () => {
    const acpFetch = createAcpFetch();
    assert.equal(typeof acpFetch, "function");
  });
});

/**
 * The turn's own socket is the first thing to learn that a remote sandbox was deleted: Daytona
 * answers `404 SANDBOX_NOT_FOUND` from its proxy while the ACP transport swallows the failure and
 * the pending prompt never settles. This wrapper is how that death reaches the liveness probe.
 */
describe("withSandboxGoneReport", () => {
  const goneResponse = () =>
    new Response("not found: sandbox a476c238 not found", {
      status: 404,
      headers: { "x-daytona-error-code": "SANDBOX_NOT_FOUND" },
    });

  it("reports a provider answer that names the sandbox as gone", async () => {
    const reasons: string[] = [];
    const wrapped = withSandboxGoneReport(
      (async () => goneResponse()) as unknown as typeof fetch,
      { onSandboxGone: (reason) => reasons.push(reason) },
    );

    const response = await wrapped("http://sandbox/v1/acp/session");

    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes("SANDBOX_NOT_FOUND"));
    // The body must still be readable by the ACP client that asked for it.
    assert.ok((await response.text()).includes("a476c238"));
  });

  it("reports nothing for an ordinary answer", async () => {
    const reasons: string[] = [];
    const wrapped = withSandboxGoneReport(
      (async () =>
        new Response("{}", { status: 200 })) as unknown as typeof fetch,
      { onSandboxGone: (reason) => reasons.push(reason) },
    );

    await wrapped("http://sandbox/v1/acp/session");

    assert.equal(reasons.length, 0);
  });

  it("is the identity when no reporter is wired", () => {
    const inner = (async () => new Response("{}")) as unknown as typeof fetch;
    assert.equal(withSandboxGoneReport(inner), inner);
  });
});
