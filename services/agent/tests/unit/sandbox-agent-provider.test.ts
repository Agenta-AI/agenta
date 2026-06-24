/**
 * Unit tests for the Layer 2 network policy -> Daytona create field mapping (S1b).
 *
 * The mapping is tested directly because the real `daytona()` provider closes over its
 * create object and constructs a Daytona client (needs API-key env), so it cannot be
 * inspected through `buildSandboxProvider`. The orchestration test covers that the run
 * plan's `sandboxPermission` reaches `buildSandboxProvider` as the new argument.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-provider.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { daytonaNetworkFields } from "../../src/engines/sandbox_agent/provider.ts";

describe("daytonaNetworkFields", () => {
  it("blocks all egress for network:off", () => {
    assert.deepEqual(
      daytonaNetworkFields({ network: { mode: "off" }, enforcement: "strict" }),
      { networkBlockAll: true },
    );
  });

  it("renders a non-empty allowlist as a comma-separated CIDR string", () => {
    assert.deepEqual(
      daytonaNetworkFields({
        network: { mode: "allowlist", allowlist: ["a", "b"] },
        enforcement: "strict",
      }),
      { networkAllowList: "a,b" },
    );
  });

  it("blocks all egress for an empty allowlist (allow zero ranges == allow nothing)", () => {
    assert.deepEqual(
      daytonaNetworkFields({
        network: { mode: "allowlist", allowlist: [] },
        enforcement: "strict",
      }),
      { networkBlockAll: true },
    );
  });

  it("leaves the sandbox default-open for network:on", () => {
    assert.deepEqual(
      daytonaNetworkFields({ network: { mode: "on" }, enforcement: "strict" }),
      {},
    );
  });

  it("leaves the sandbox default-open when no policy is set", () => {
    assert.deepEqual(daytonaNetworkFields(undefined), {});
  });
});
