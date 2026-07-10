/**
 * Unit tests for the relay execution guard (finding P1).
 *
 * The relay dir is sandbox-writable, so the model can forge an `<id>.req.json` execute record
 * without ever passing the in-sandbox `ctx.ui.confirm` dialog. The guard is the runner-side
 * re-check: an author-allow tool executes, an author-deny tool never does, and an `ask` tool
 * executes only by consuming a grant the dialog gate (or a parked-approval resume) recorded.
 * The guard here is composed exactly the way `runTurn` builds it (decide + an EMPTY stored
 * decision store + the grant ledger + context-binding redaction) so the test pins the composed
 * behavior, not just the pieces.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-relay-guard.test.ts)
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
  redactContextBoundArgs,
  startToolRelay,
  type RelayExecutionGuard,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import {
  ApprovedExecutionGrants,
  ConversationDecisions,
} from "../../src/responder.ts";
import { decide, type PermissionPlan } from "../../src/permission-plan.ts";

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

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(body = "ok"): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return calls;
}

/** The guard exactly as `runTurn` composes it: decide() over an EMPTY stored-decision store
 *  (the dialog is the stored decisions' consumer, never the guard), then the grant ledger,
 *  consuming under the same redaction `handlePiGate` applied when the grant was recorded. */
function buildRelayGuard(
  permissionPlan: PermissionPlan,
  executionGrants: ApprovedExecutionGrants,
): RelayExecutionGuard {
  const relayGuardDecisions = new ConversationDecisions(new Map());
  return (spec, req) => {
    const verdict = decide(
      {
        executor: "relay",
        toolName: spec.name,
        specPermission: spec.permission,
        readOnlyHint: spec.readOnly,
        args: req.args,
      },
      permissionPlan,
      relayGuardDecisions,
    );
    if (verdict.kind === "allow") return { allow: true };
    if (verdict.kind === "deny") {
      return {
        allow: false,
        reason: `Tool '${spec.name}' is denied by the permission policy.`,
      };
    }
    return executionGrants.consume(
      spec.name,
      redactContextBoundArgs(
        req.args,
        spec.callRef ? spec.contextBindings : undefined,
      ),
    )
      ? { allow: true }
      : {
          allow: false,
          reason: `Tool '${spec.name}' was not approved via the permission dialog.`,
        };
  };
}

/** Write one forged execute record and run the relay over it (a record the model could write
 *  itself with bash — it proves nothing about the dialog having run). */
async function relayOnce(input: {
  spec: ResolvedToolSpec;
  args: unknown;
  guard?: RelayExecutionGuard;
  runContext?: RunContext;
}): Promise<RelayResponse> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-relay-guard-"));
  try {
    const id = "call-1";
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({
        toolName: input.spec.name,
        toolCallId: id,
        args: input.args,
      }),
    );
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [input.spec],
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      input.runContext,
      undefined,
      input.guard,
    );
    const resPath = join(dir, `${id}.res.json`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(resPath)) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await relay.stop();
    assert.ok(existsSync(resPath), "the relay wrote a response file");
    return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function askSpec(overrides: Partial<ResolvedToolSpec> = {}): ResolvedToolSpec {
  return {
    name: "park_probe",
    kind: "callback",
    callRef: "tools.agenta.park_probe",
    permission: "ask",
    ...overrides,
  };
}

const ASK_PLAN: PermissionPlan = { default: "ask", rules: [] };

describe("startToolRelay execution guard", () => {
  it("a forged record for an `ask` tool with no grant fails closed, never fetching", async () => {
    const calls = stubFetch();
    const guard = buildRelayGuard(ASK_PLAN, new ApprovedExecutionGrants());

    const res = await relayOnce({
      spec: askSpec(),
      args: { token: "T" },
      guard,
    });

    assert.equal(res.ok, true, "a guard deny is a tool RESULT, not an error");
    assert.match(res.text ?? "", /was not approved/);
    assert.equal(calls.length, 0, "the forged record never executed");
  });

  it("a granted call executes exactly once; a replayed identical record is denied", async () => {
    const calls = stubFetch();
    const executionGrants = new ApprovedExecutionGrants();
    const guard = buildRelayGuard(ASK_PLAN, executionGrants);
    const args = { token: "T" };
    // The dialog gate approved this exact call once (as handlePiGate records it).
    executionGrants.grant("park_probe", args);

    const first = await relayOnce({ spec: askSpec(), args, guard });
    assert.equal(first.ok, true);
    assert.equal(calls.length, 1, "the approved call executed");

    const replay = await relayOnce({ spec: askSpec(), args, guard });
    assert.match(replay.text ?? "", /was not approved/);
    assert.equal(calls.length, 1, "the replayed record consumed nothing");
  });

  it("an author-deny tool is denied regardless of any record", async () => {
    const calls = stubFetch();
    const guard = buildRelayGuard(ASK_PLAN, new ApprovedExecutionGrants());

    const res = await relayOnce({
      spec: askSpec({ permission: "deny" }),
      args: {},
      guard,
    });

    assert.match(res.text ?? "", /denied by the permission policy/);
    assert.equal(calls.length, 0);
  });

  it("an author-allow tool executes with no grant (instant-allow parity with the dialog)", async () => {
    const calls = stubFetch();
    const guard = buildRelayGuard(ASK_PLAN, new ApprovedExecutionGrants());

    const res = await relayOnce({
      spec: askSpec({ permission: "allow" }),
      args: {},
      guard,
    });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
  });

  it("no guard at all executes unconditionally (Claude parity: gates fire before the relay)", async () => {
    const calls = stubFetch();

    const res = await relayOnce({ spec: askSpec(), args: { token: "T" } });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
  });

  it("a contextBindings tool: the grant is keyed on REDACTED args and matches the raw record", async () => {
    const calls = stubFetch();
    const executionGrants = new ApprovedExecutionGrants();
    const guard = buildRelayGuard(ASK_PLAN, executionGrants);
    const spec = askSpec({
      contextBindings: {
        "target.workflow_variant_id": "$ctx.workflow.variant.id",
      },
    });
    const rawArgs = {
      target: { workflow_variant_id: "model-sent" },
      inputs: { city: "Berlin" },
    };
    // handlePiGate grants with the redacted shape (the bound path is runner-filled at
    // execution, so neither the card nor the grant key may carry the model's value for it).
    executionGrants.grant(
      spec.name,
      redactContextBoundArgs(rawArgs, spec.contextBindings),
    );

    const res = await relayOnce({
      spec,
      args: rawArgs,
      guard,
      runContext: RUN_CONTEXT,
    });

    assert.equal(res.ok, true, "redaction applied on both sides -> consumed");
    assert.equal(calls.length, 1);
    const posted = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(
      posted.data.function.arguments.target,
      { workflow_variant_id: "own-variant" },
      "execution still binds the runner's own context value",
    );
  });
});
