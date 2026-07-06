/**
 * Unit tests for builtin permission records on the runner relay.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-relay-permission-record.test.ts)
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
  parsePermissionRelayResponse,
  RELAY_PERMISSION_PROTOCOL,
  startToolRelay,
  type PermissionRelayResponse,
  type RelayPermissions,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";
import {
  decide,
  type GateDescriptor,
  type PermissionPlan,
} from "../../src/permission-plan.ts";
import { approvedCallKey, ConversationDecisions } from "../../src/responder.ts";

const codeSpec: ResolvedToolSpec = {
  name: "server_tool",
  kind: "code",
  runtime: "python",
  code: "def main(**kw):\n    return kw\n",
};

function permissionPlan(
  defaultMode: PermissionPlan["default"],
  rules: PermissionPlan["rules"] = [],
): PermissionPlan {
  return { default: defaultMode, rules };
}

function permissions(
  input: {
    plan?: PermissionPlan;
    decisions?: ConversationDecisions;
    pending?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
    gates?: GateDescriptor[];
    pendingEmitted?: boolean;
  } = {},
): RelayPermissions {
  const plan = input.plan ?? permissionPlan("allow");
  const decisions = input.decisions ?? new ConversationDecisions(new Map());
  return {
    enforce: true,
    decide: (gate) => {
      input.gates?.push(gate);
      return decide(gate, plan, decisions);
    },
    onPendingApproval: (info) => {
      input.pending?.push(info);
      return { emitted: input.pendingEmitted ?? true };
    },
  };
}

function permissionRecord(
  toolName: string,
  args: unknown = { command: "pwd" },
): Record<string, unknown> {
  return {
    kind: "permission",
    protocol: RELAY_PERMISSION_PROTOCOL,
    toolName,
    toolCallId: "call-1",
    args,
  };
}

async function relayRecordOnce(input: {
  record: Record<string, unknown>;
  permissions: RelayPermissions;
  specs?: ResolvedToolSpec[];
}): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-relay-permission-record-"));
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
    const resPath = join(dir, `${id}.res.json`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(resPath)) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await relay.stop();
    assert.ok(existsSync(resPath), "the relay wrote a response file");
    return JSON.parse(readFileSync(resPath, "utf-8")) as unknown;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function permissionRelayOnce(input: {
  record: Record<string, unknown>;
  permissions: RelayPermissions;
}): Promise<PermissionRelayResponse> {
  const raw = await relayRecordOnce(input);
  const parsed = parsePermissionRelayResponse(raw);
  assert.ok(parsed, `permission response validated: ${JSON.stringify(raw)}`);
  return parsed;
}

describe("parsePermissionRelayResponse", () => {
  it("accepts permission responses and rejects execute-shaped records", () => {
    assert.deepEqual(
      parsePermissionRelayResponse({
        kind: "permission",
        ok: true,
        verdict: "allow",
      }),
      { kind: "permission", ok: true, verdict: "allow" },
    );
    assert.equal(
      parsePermissionRelayResponse({ ok: true, text: "{}" }),
      undefined,
    );
  });
});

describe("startToolRelay builtin permission records", () => {
  it("writes an allow permission response under an all-allow policy", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const gates: GateDescriptor[] = [];

    const res = await permissionRelayOnce({
      record: permissionRecord("bash", { command: "pwd" }),
      permissions: permissions({
        plan: permissionPlan("allow"),
        pending,
        gates,
      }),
    });

    assert.deepEqual(res, { kind: "permission", ok: true, verdict: "allow" });
    assert.deepEqual(pending, []);
    assert.deepEqual(gates, [
      {
        executor: "harness",
        toolName: "Bash",
        readOnlyHint: false,
        args: { command: "pwd" },
      },
    ]);
  });

  it("writes a deny permission response with the relay policy wording", async () => {
    const res = await permissionRelayOnce({
      record: permissionRecord("bash", { command: "rm -rf /tmp/nope" }),
      permissions: permissions({ plan: permissionPlan("deny") }),
    });

    assert.deepEqual(res, {
      kind: "permission",
      ok: true,
      verdict: "deny",
      reason: "Tool 'bash' is denied by the permission policy.",
    });
  });

  it("calls onPendingApproval and writes pendingApproval verbatim", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];

    const res = await permissionRelayOnce({
      record: permissionRecord("bash", { command: "npm test" }),
      permissions: permissions({
        plan: permissionPlan("ask"),
        pending,
      }),
    });

    assert.deepEqual(pending, [
      { toolCallId: "call-1", toolName: "bash", args: { command: "npm test" } },
    ]);
    assert.deepEqual(res, {
      kind: "permission",
      ok: true,
      verdict: "pendingApproval",
      reason: "Waiting for approval of bash.",
    });
  });

  it("writes the another-approval reason when the pending latch is held", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];

    const res = await permissionRelayOnce({
      record: permissionRecord("write", { path: "a.txt", content: "x" }),
      permissions: permissions({
        plan: permissionPlan("ask"),
        pending,
        pendingEmitted: false,
      }),
    });

    assert.deepEqual(pending, [
      {
        toolCallId: "call-1",
        toolName: "write",
        args: { path: "a.txt", content: "x" },
      },
    ]);
    assert.deepEqual(res, {
      kind: "permission",
      ok: true,
      verdict: "pendingApproval",
      reason: "Another approval is pending; retry after it resolves.",
    });
  });

  it("allows read builtins under allow_reads and asks for write builtins", async () => {
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const relayPermissions = permissions({
      plan: permissionPlan("allow_reads"),
      pending,
    });

    const grep = await permissionRelayOnce({
      record: permissionRecord("grep", { pattern: "TODO", path: "." }),
      permissions: relayPermissions,
    });
    assert.deepEqual(grep, { kind: "permission", ok: true, verdict: "allow" });

    const write = await permissionRelayOnce({
      record: permissionRecord("write", { path: "a.txt", content: "x" }),
      permissions: relayPermissions,
    });
    assert.equal(write.verdict, "pendingApproval");
    assert.deepEqual(pending, [
      {
        toolCallId: "call-1",
        toolName: "write",
        args: { path: "a.txt", content: "x" },
      },
    ]);
  });

  it("matches Bash prefix rules on the real command arg after name normalization", async () => {
    const gates: GateDescriptor[] = [];

    const res = await permissionRelayOnce({
      record: permissionRecord("bash", { command: "git status" }),
      permissions: permissions({
        plan: permissionPlan("deny", [
          { pattern: "Bash(git:*)", permission: "allow" },
        ]),
        gates,
      }),
    });

    assert.deepEqual(res, { kind: "permission", ok: true, verdict: "allow" });
    assert.deepEqual(gates[0], {
      executor: "harness",
      toolName: "Bash",
      readOnlyHint: false,
      args: { command: "git status" },
    });
  });

  it("projects stored bash approvals by command but keeps write approvals exact", async () => {
    const bashKey = approvedCallKey("bash", { command: "npm test" })!;
    const writeKey = approvedCallKey("write", {
      path: "a.txt",
      content: "old",
    })!;
    const pending: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }> = [];
    const relayPermissions = permissions({
      plan: permissionPlan("ask"),
      decisions: new ConversationDecisions(
        new Map([
          [bashKey, "allow"],
          [writeKey, "allow"],
        ]),
      ),
      pending,
    });

    const bash = await permissionRelayOnce({
      record: permissionRecord("bash", { command: "npm test", timeout: 10 }),
      permissions: relayPermissions,
    });
    assert.deepEqual(bash, { kind: "permission", ok: true, verdict: "allow" });

    const write = await permissionRelayOnce({
      record: permissionRecord("write", { path: "a.txt", content: "new" }),
      permissions: relayPermissions,
    });
    assert.equal(write.verdict, "pendingApproval");
    assert.deepEqual(pending, [
      {
        toolCallId: "call-1",
        toolName: "write",
        args: { path: "a.txt", content: "new" },
      },
    ]);
  });

  it("fails closed on missing or unknown permission protocol versions", async () => {
    for (const record of [
      { kind: "permission", toolName: "bash", toolCallId: "call-1", args: {} },
      {
        kind: "permission",
        protocol: 999,
        toolName: "bash",
        toolCallId: "call-1",
        args: {},
      },
    ]) {
      const res = await permissionRelayOnce({
        record,
        permissions: permissions({ plan: permissionPlan("allow") }),
      });

      assert.equal(res.kind, "permission");
      assert.equal(res.ok, true);
      assert.equal(res.verdict, "deny");
      assert.match(res.reason ?? "", /runner\/extension version mismatch/);
    }
  });

  it("fails closed on an unknown builtin without calling decide", async () => {
    const gates: GateDescriptor[] = [];

    const res = await permissionRelayOnce({
      record: permissionRecord("cat", { path: "a.txt" }),
      permissions: permissions({ plan: permissionPlan("allow"), gates }),
    });

    assert.deepEqual(gates, []);
    assert.deepEqual(res, {
      kind: "permission",
      ok: true,
      verdict: "deny",
      reason: "Tool 'cat' is denied by the permission policy.",
    });
  });

  it("leaves execute records with no kind on the existing relay path", async () => {
    const raw = await relayRecordOnce({
      record: { toolName: "server_tool", toolCallId: "call-1", args: { a: 1 } },
      permissions: {
        enforce: false,
        decide: () => ({ kind: "allow" }),
        onPendingApproval: () => ({ emitted: false }),
      },
      specs: [codeSpec],
    });
    const res = raw as RelayResponse;

    assert.equal("kind" in (raw as Record<string, unknown>), false);
    assert.equal(res.ok, false);
    assert.match(
      res.error ?? "",
      /Code tools are not supported by the sidecar\./,
    );
  });
});
