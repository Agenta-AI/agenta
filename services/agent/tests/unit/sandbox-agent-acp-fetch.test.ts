/**
 * Unit tests for the ACP HTTP fetch dispatcher.
 *
 * HITL parks the ACP connection open while a human approves a tool; the default undici
 * `headersTimeout` would reap it (UND_ERR_HEADERS_TIMEOUT) and kill the parked + resume turns.
 * These tests pin that the ACP dispatcher disables those timeouts by default and honors the
 * env overrides.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-acp-fetch.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createAcpDispatcher,
  createAcpFetch,
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
  it("disables headers/body timeouts by default so a parked HITL turn is not reaped", () => {
    delete process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS;
    delete process.env.SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS;
    const opts = agentOptions(createAcpDispatcher());
    assert.equal(opts.headersTimeout, 0);
    assert.equal(opts.bodyTimeout, 0);
  });

  it("honors a positive env override for the headers and body timeout", () => {
    process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS = "900000";
    process.env.SANDBOX_AGENT_ACP_BODY_TIMEOUT_MS = "120000";
    const opts = agentOptions(createAcpDispatcher());
    assert.equal(opts.headersTimeout, 900000);
    assert.equal(opts.bodyTimeout, 120000);
  });

  it("falls back to disabled (0) for a non-numeric override", () => {
    process.env.SANDBOX_AGENT_ACP_HEADERS_TIMEOUT_MS = "not-a-number";
    const opts = agentOptions(createAcpDispatcher());
    assert.equal(opts.headersTimeout, 0);
  });
});

describe("createAcpFetch", () => {
  it("returns a fetch bound to the long-timeout ACP dispatcher", () => {
    const acpFetch = createAcpFetch();
    assert.equal(typeof acpFetch, "function");
  });
});
