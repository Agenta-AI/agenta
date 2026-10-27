/**
 * The capability probe is reused per harness for local daemons: a second acquire with the same
 * key does not ask the daemon again, a failed probe is never kept, and a run without a key (every
 * Daytona run) probes each time.
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  capabilityProbeCacheKey,
  probe,
  resetCapabilityProbeCache,
} from "../../src/environment/harness-session-lifecycle.ts";
import { probeCapabilities } from "../../src/engines/sandbox_agent/capabilities.ts";

const fakeSandbox = (answers: Array<() => Promise<unknown>>) => {
  let calls = 0;
  return {
    sandbox: {
      createSession: () => {},
      getAgent: async () => answers[Math.min(calls++, answers.length - 1)]!(),
    },
    calls: () => calls,
  };
};

const PROBED = async () => ({ capabilities: { mcpTools: true, images: true } });
const FAILS = async () => {
  throw new Error("daemon not ready");
};

const run = (sandbox: unknown, cacheKey: string | undefined, stages: string[] = []) =>
  probe({
    sandbox: sandbox as { createSession?: unknown },
    acpAgent: "pi",
    timingLog: (stage) => void stages.push(stage),
    ...(cacheKey ? { cacheKey } : {}),
  });

afterEach(() => resetCapabilityProbeCache());

describe("capability probe reuse", () => {
  it("asks a local daemon once per key and reuses the answer", async () => {
    const key = capabilityProbeCacheKey("local", "pi", "/bin/sandbox-agent");
    const first = fakeSandbox([PROBED]);
    const second = fakeSandbox([PROBED]);
    const stages: string[] = [];
    const a = await run(first.sandbox, key, stages);
    const b = await run(second.sandbox, key, stages);
    assert.equal(first.calls(), 1);
    assert.equal(second.calls(), 0, "the second daemon is not asked");
    assert.deepEqual(b, a);
    assert.equal(b.source, "probed");
    // The stage is still reported on a reused answer, so the timing series keeps its shape.
    assert.deepEqual(stages, ["probe_capabilities", "probe_capabilities"]);
  });

  it("hands each caller its own copy", async () => {
    const key = capabilityProbeCacheKey("local", "pi", "/bin/sandbox-agent");
    const a = await run(fakeSandbox([PROBED]).sandbox, key);
    a.capabilities.mcpTools = false;
    const b = await run(fakeSandbox([PROBED]).sandbox, key);
    assert.equal(b.capabilities.mcpTools, true);
  });

  it("does not keep the static fallback of a failed probe", async () => {
    const key = capabilityProbeCacheKey("local", "pi", "/bin/sandbox-agent");
    const failing = fakeSandbox([FAILS]);
    const a = await run(failing.sandbox, key);
    assert.equal(a.source, "static");
    const next = fakeSandbox([PROBED]);
    const b = await run(next.sandbox, key);
    assert.equal(next.calls(), 1, "the next acquire asks again");
    assert.equal(b.source, "probed");
  });

  it("keys on the harness, so another harness is probed", async () => {
    const pi = capabilityProbeCacheKey("local", "pi", "/bin/sandbox-agent");
    const claude = capabilityProbeCacheKey("local", "claude", "/bin/sandbox-agent");
    assert.notEqual(pi, claude);
    await run(fakeSandbox([PROBED]).sandbox, pi);
    const other = fakeSandbox([PROBED]);
    await run(other.sandbox, claude);
    assert.equal(other.calls(), 1);
  });

  it("gives no key for daytona or inprocess, so those probe every time", async () => {
    assert.equal(capabilityProbeCacheKey("daytona", "pi", undefined), undefined);
    assert.equal(capabilityProbeCacheKey("inprocess", "pi", undefined), undefined);
    const first = fakeSandbox([PROBED]);
    const second = fakeSandbox([PROBED]);
    await run(first.sandbox, undefined);
    await run(second.sandbox, undefined);
    assert.equal(first.calls() + second.calls(), 2);
  });

  it("passes a probe error through unchanged and keeps nothing", async () => {
    const key = capabilityProbeCacheKey("local", "pi", "/bin/sandbox-agent");
    await assert.rejects(
      probe(
        { sandbox: {}, acpAgent: "pi", timingLog: () => {}, cacheKey: key! },
        { probeCapabilities },
      ),
      /requires a sandbox with getAgent/,
    );
    const next = fakeSandbox([PROBED]);
    await run(next.sandbox, key);
    assert.equal(next.calls(), 1);
  });
});
