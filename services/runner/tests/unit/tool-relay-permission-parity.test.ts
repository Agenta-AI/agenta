/**
 * Phase 4 (docs/design/agent-workflows/projects/pi-builtin-gating/plan.md): parity and
 * regression-pin tests for the relay's builtin-gating seam.
 *
 * Parity: a builtin `bash` pending (a `kind: "permission"` record, handled by
 * `handlePermissionRelayRequest`) and a custom relay tool's `ask` pending (a `kind: "execute"`
 * record, handled by `executeRelayedTool`) are two different code paths inside
 * `startToolRelay`, but both route through the SAME `onPendingApproval` callback with the SAME
 * `{toolCallId, toolName, args}` shape. A caller downstream of the relay (the responder / SSE
 * pause plumbing) can treat every pending pause uniformly, regardless of which path produced
 * it — the engine wraps both identically.
 *
 * Regression pin (0e71bd0f7a): a run whose `tools` omits `bash` must not grant it, both at the
 * `RunPlan` layer (`buildRunPlan`) and at the extension's active-tool-set layer
 * (`replaceActiveBuiltinTools`). This bug shipped once as a silently-dropped grant list; pin it
 * at both layers so it cannot recur unnoticed at either one.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-relay-permission-parity.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localRelayHost,
  RELAY_PERMISSION_PROTOCOL,
  startToolRelay,
  type RelayPermissions,
} from "../../src/tools/relay.ts";
import type { AgentRunRequest, ResolvedToolSpec } from "../../src/protocol.ts";
import { decide, type PermissionPlan } from "../../src/permission-plan.ts";
import { ConversationDecisions } from "../../src/responder.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import { replaceActiveBuiltinTools } from "../../src/extensions/agenta.ts";

type PendingInfo = { toolCallId: string; toolName: string; args: unknown };

function askPlan(): PermissionPlan {
  return { default: "ask", rules: [] };
}

/** A RelayPermissions whose `decide` always resolves through an `ask` default plan, and whose
 *  `onPendingApproval` appends every call it receives to `pending` verbatim. */
function collectingPermissions(pending: PendingInfo[]): RelayPermissions {
  const decisions = new ConversationDecisions(new Map());
  const plan = askPlan();
  return {
    enforce: true,
    decide: (gate) => decide(gate, plan, decisions),
    onPendingApproval: (info) => {
      pending.push(info);
      return { emitted: true };
    },
  };
}

/** Write one relay request record, start the relay, and wait until `onPendingApproval` has
 *  fired (or the deadline passes), then stop the relay. */
async function relayUntilPending(input: {
  record: Record<string, unknown>;
  permissions: RelayPermissions;
  pending: PendingInfo[];
  specs?: ResolvedToolSpec[];
}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-relay-parity-"));
  try {
    const id =
      typeof input.record.toolCallId === "string"
        ? input.record.toolCallId
        : "call-1";
    writeFileSync(join(dir, `${id}.req.json`), JSON.stringify(input.record));
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      input.specs ?? [],
      undefined,
      input.permissions,
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && input.pending.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await relay.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("onPendingApproval parity: builtin permission record vs custom relay tool", () => {
  it("delivers the same {toolCallId, toolName, args} shape from both pending paths", async () => {
    const builtinPending: PendingInfo[] = [];
    await relayUntilPending({
      record: {
        kind: "permission",
        protocol: RELAY_PERMISSION_PROTOCOL,
        toolName: "bash",
        toolCallId: "builtin-call-1",
        args: { command: "npm test" },
      },
      permissions: collectingPermissions(builtinPending),
      pending: builtinPending,
    });

    const customPending: PendingInfo[] = [];
    const customSpec: ResolvedToolSpec = {
      name: "send_email",
      kind: "code",
      runtime: "python",
      code: "def main(**kw):\n    return kw\n",
      permission: "ask",
    };
    await relayUntilPending({
      record: {
        toolName: "send_email",
        toolCallId: "custom-call-1",
        args: { to: "a@b.com" },
      },
      permissions: collectingPermissions(customPending),
      pending: customPending,
      specs: [customSpec],
    });

    assert.equal(builtinPending.length, 1, "the builtin path paused exactly once");
    assert.equal(customPending.length, 1, "the custom-tool path paused exactly once");

    const [builtin] = builtinPending;
    const [custom] = customPending;

    // Same seam, same keys: neither path leaks extra fields (e.g. a `kind` discriminator) into
    // the callback, and neither drops one of the three.
    assert.deepEqual(Object.keys(builtin).sort(), ["args", "toolCallId", "toolName"]);
    assert.deepEqual(Object.keys(custom).sort(), ["args", "toolCallId", "toolName"]);

    assert.deepEqual(builtin, {
      toolCallId: "builtin-call-1",
      toolName: "bash",
      args: { command: "npm test" },
    });
    assert.deepEqual(custom, {
      toolCallId: "custom-call-1",
      toolName: "send_email",
      args: { to: "a@b.com" },
    });
  });
});

describe("grant-list regression pin (0e71bd0f7a)", () => {
  it("buildRunPlan excludes bash from builtinGrants and turns gating on when `tools` omits it", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        tools: ["read"],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.builtinGrants, ["read"]);
    assert.ok(
      !result.plan.builtinGrants.includes("bash"),
      "bash must not be silently re-granted",
    );
    assert.equal(result.plan.builtinGatingActive, true);
  });

  it("replaceActiveBuiltinTools drops bash/edit/write and keeps read when only read is granted", () => {
    const allTools = [
      { name: "read" },
      { name: "bash" },
      { name: "edit" },
      { name: "write" },
      { name: "grep" },
      { name: "find" },
      { name: "ls" },
    ];

    const next = replaceActiveBuiltinTools(
      ["read", "bash", "edit", "write"],
      allTools,
      ["read"],
    );

    assert.deepEqual(next, ["read"]);
    assert.ok(!next.includes("bash"));
    assert.ok(!next.includes("edit"));
    assert.ok(!next.includes("write"));
  });
});
