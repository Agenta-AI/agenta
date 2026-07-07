/**
 * Unit tests for runner-side relay permission enforcement.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-relay-permission.test.ts)
 */
import { describe, it } from "vitest";
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

import {
  localRelayHost,
  RELAY_POLL_MAX_MS,
  RELAY_POLL_MS,
  relayPollDelayMs,
  startToolRelay,
  type ClientToolRelay,
  type RelayPermissions,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";
import { decide, type PermissionPlan } from "../../src/permission-plan.ts";
import { approvedCallKey, ConversationDecisions } from "../../src/responder.ts";

describe("relayPollDelayMs (idle backoff)", () => {
  it("polls at the base rate while busy, then backs off geometrically up to the cap", () => {
    // No idle polls -> base rate.
    assert.equal(relayPollDelayMs(0), RELAY_POLL_MS);
    assert.equal(
      relayPollDelayMs(4),
      RELAY_POLL_MS,
      "still base before the grow threshold",
    );
    // After the threshold the delay grows but never exceeds the cap.
    assert.ok(relayPollDelayMs(5) > RELAY_POLL_MS, "grows once idle");
    assert.ok(relayPollDelayMs(5) <= RELAY_POLL_MAX_MS);
    assert.equal(
      relayPollDelayMs(100),
      RELAY_POLL_MAX_MS,
      "saturates at the cap",
    );
    // Monotonic non-decreasing.
    assert.ok(relayPollDelayMs(6) >= relayPollDelayMs(5));
  });
});

const codeSpec = (
  name: string,
  permission?: ResolvedToolSpec["permission"],
  readOnly?: boolean,
): ResolvedToolSpec => ({
  name,
  kind: "code",
  runtime: "python",
  code: 'def main(**kw):\n    return {"ran": True, "echo": kw}\n',
  permission,
  readOnly,
});

function permissionPlan(
  defaultMode: PermissionPlan["default"],
): PermissionPlan {
  return { default: defaultMode, rules: [] };
}

function permissions(input: {
  enforce: boolean;
  plan?: PermissionPlan;
  decisions?: ConversationDecisions;
  pending?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
}): RelayPermissions {
  const plan = input.plan ?? permissionPlan("allow");
  const decisions = input.decisions ?? new ConversationDecisions(new Map());
  return {
    enforce: input.enforce,
    decide: (gate) => decide(gate, plan, decisions),
    onPendingApproval: (info) => {
      input.pending?.push(info);
      return { emitted: true };
    },
  };
}

async function relayOnce(input: {
  spec: ResolvedToolSpec;
  permissions: RelayPermissions;
  args?: unknown;
  id?: string;
  expectResponse?: boolean;
  stopWhen?: () => boolean;
  clientToolRelay?: ClientToolRelay;
}): Promise<RelayResponse | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-relay-perm-"));
  try {
    const id = input.id ?? "call-1";
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({
        toolName: input.spec.name,
        toolCallId: id,
        args: input.args ?? { a: 1 },
      }),
    );
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [input.spec],
      undefined,
      input.permissions,
      undefined,
      input.clientToolRelay,
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

function assertCodeToolExecuted(res: RelayResponse | undefined): void {
  assert.equal(res?.ok, false);
  assert.match(
    res?.error ?? "",
    /Code tools are not supported by the sidecar\./,
  );
}

describe("startToolRelay permission enforcement", () => {
  it("enforce=false executes an ask spec without pausing", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const res = await relayOnce({
      spec: codeSpec("needs_approval", "ask"),
      permissions: permissions({
        enforce: false,
        plan: permissionPlan("ask"),
        pending,
      }),
    });

    assertCodeToolExecuted(res);
    assert.deepEqual(pending, []);
  });

  it("enforce=true allows allowed tools and refuses authored deny distinctly", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const allow = await relayOnce({
      spec: codeSpec("permitted", "allow"),
      permissions: permissions({
        enforce: true,
        plan: permissionPlan("ask"),
        pending,
      }),
    });
    assertCodeToolExecuted(allow);

    const deny = await relayOnce({
      spec: codeSpec("blocked", "deny"),
      permissions: permissions({
        enforce: true,
        plan: permissionPlan("allow"),
        pending,
      }),
    });
    assert.equal(deny?.ok, true);
    assert.equal(deny?.text, "Tool 'blocked' is denied by policy.");
    assert.deepEqual(pending, []);
  });

  it("enforce=true refuses policy deny with the permission-policy text", async () => {
    const res = await relayOnce({
      spec: codeSpec("locked_down"),
      permissions: permissions({ enforce: true, plan: permissionPlan("deny") }),
    });

    assert.equal(res?.ok, true);
    assert.equal(
      res?.text,
      "Tool 'locked_down' is denied by the permission policy.",
    );
  });

  it("ask with no stored decision pauses without writing a response or executing", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    await relayOnce({
      spec: codeSpec("approval_needed", "ask"),
      permissions: permissions({
        enforce: true,
        plan: permissionPlan("allow"),
        pending,
      }),
      expectResponse: false,
      stopWhen: () => pending.length === 1,
    });

    assert.deepEqual(pending, [
      { toolCallId: "call-1", toolName: "approval_needed", args: { a: 1 } },
    ]);
  });

  it("ask with a stored allow executes once and consumes the stored decision", async () => {
    const key = approvedCallKey("approval_needed", { a: 1 })!;
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const relayPermissions = permissions({
      enforce: true,
      plan: permissionPlan("allow"),
      decisions: new ConversationDecisions(new Map([[key, "allow"]])),
      pending,
    });

    const first = await relayOnce({
      id: "call-1",
      spec: codeSpec("approval_needed", "ask"),
      permissions: relayPermissions,
    });
    assertCodeToolExecuted(first);
    assert.deepEqual(pending, []);

    await relayOnce({
      id: "call-2",
      spec: codeSpec("approval_needed", "ask"),
      permissions: relayPermissions,
      expectResponse: false,
      stopWhen: () => pending.length === 1,
    });
    assert.deepEqual(pending, [
      { toolCallId: "call-2", toolName: "approval_needed", args: { a: 1 } },
    ]);
  });

  it("allow_reads executes read-hinted tools and pauses tools without a read hint", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const relayPermissions = permissions({
      enforce: true,
      plan: permissionPlan("allow_reads"),
      pending,
    });

    const read = await relayOnce({
      id: "read-call",
      spec: codeSpec("read_tool", undefined, true),
      permissions: relayPermissions,
    });
    assertCodeToolExecuted(read);

    await relayOnce({
      id: "write-call",
      spec: codeSpec("write_tool"),
      permissions: relayPermissions,
      expectResponse: false,
      stopWhen: () => pending.length === 1,
    });
    assert.deepEqual(pending, [
      { toolCallId: "write-call", toolName: "write_tool", args: { a: 1 } },
    ]);
  });

  it("client tools use pendingApproval to park without writing a relay response", async () => {
    const parked: string[] = [];
    await relayOnce({
      spec: { name: "request_connection", kind: "client" },
      permissions: permissions({ enforce: true }),
      args: { integration: "slack" },
      expectResponse: false,
      stopWhen: () => parked.length === 1,
      clientToolRelay: {
        onClientTool: async () => "pendingApproval",
        onPause: (request) => {
          parked.push(request.toolCallId);
        },
      },
    });

    assert.deepEqual(parked, ["call-1"]);
  });
});
