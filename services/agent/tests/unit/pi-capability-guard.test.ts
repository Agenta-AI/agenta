import { describe, it } from "vitest";
import assert from "node:assert";

import { unenforceableCapabilityConfig } from "../../src/engines/pi.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";

/**
 * The in-process `pi` backend has no sandbox and runs tools without the relay, so it must reject
 * capability config it cannot enforce instead of silently ignoring it (the backend-routing footgun
 * found in live QA). `sandbox-agent` is the enforcing backend.
 */
function req(extra: Partial<AgentRunRequest>): AgentRunRequest {
  return { harness: "pi", messages: [], ...extra } as AgentRunRequest;
}

describe("unenforceableCapabilityConfig (in-process pi guard)", () => {
  it("passes a plain request (no capability config)", () => {
    assert.equal(unenforceableCapabilityConfig(req({})), undefined);
  });

  it("passes a permissive sandbox_permission (network on, no fs restriction)", () => {
    assert.equal(
      unenforceableCapabilityConfig(
        req({ sandboxPermission: { network: { mode: "on" }, enforcement: "strict" } }),
      ),
      undefined,
    );
  });

  it("rejects a restricted network", () => {
    const msg = unenforceableCapabilityConfig(
      req({ sandboxPermission: { network: { mode: "off" }, enforcement: "strict" } }),
    );
    assert.match(msg ?? "", /cannot enforce sandbox_permission\.network='off'/);
  });

  it("rejects an allowlist network too", () => {
    const msg = unenforceableCapabilityConfig(
      req({
        sandboxPermission: { network: { mode: "allowlist", allowlist: ["10.0.0.0/8"] }, enforcement: "strict" },
      }),
    );
    assert.match(msg ?? "", /network='allowlist'/);
  });

  it("rejects a restricting filesystem", () => {
    const msg = unenforceableCapabilityConfig(
      req({ sandboxPermission: { network: { mode: "on" }, filesystem: "readonly", enforcement: "strict" } }),
    );
    assert.match(msg ?? "", /filesystem='readonly'/);
  });

  it("rejects a deny tool permission and names the tool", () => {
    const msg = unenforceableCapabilityConfig(
      req({ customTools: [{ kind: "code", name: "danger", permission: "deny" } as never] }),
    );
    assert.match(msg ?? "", /does not enforce tool permissions/);
    assert.match(msg ?? "", /danger/);
  });

  it("rejects an ask tool permission", () => {
    const msg = unenforceableCapabilityConfig(
      req({ customTools: [{ kind: "code", name: "t", permission: "ask" } as never] }),
    );
    assert.match(msg ?? "", /deny\/ask/);
  });

  it("passes an allow permission (no enforcement needed)", () => {
    assert.equal(
      unenforceableCapabilityConfig(
        req({ customTools: [{ kind: "code", name: "t", permission: "allow" } as never] }),
      ),
      undefined,
    );
  });
});
