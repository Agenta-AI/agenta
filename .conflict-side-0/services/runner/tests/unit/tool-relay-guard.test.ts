/**
 * Unit tests for the relay execution guard (finding P1), now the REAL builder `runTurn` uses
 * (`buildRelayExecutionGuard`), built for EVERY harness.
 *
 * The relay dir is sandbox-writable, so any in-sandbox process can forge an `<id>.req.json`
 * execute record without ever passing an approval dialog. The guard is the runner-side
 * re-check: on every harness an author-allow tool executes and an author-deny tool never does.
 * `ask` splits by harness — Pi executes only by consuming a grant the dialog gate (or a
 * parked-approval resume) recorded; a non-Pi MCP harness (Claude) passes `ask` WITHOUT a grant
 * because its own harness enforces the ask dialog before a call reaches the shim (the stated
 * residual: a forged file can still trigger an ask-tool without a dialog there — full
 * ask-grant parity for MCP harnesses is a documented follow-up).
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
import { ApprovedExecutionGrants } from "../../src/responder.ts";
import type { PermissionPlan } from "../../src/permission-plan.ts";
import { buildRelayExecutionGuard } from "../../src/engines/sandbox_agent/relay-guard.ts";

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

/** The Pi-shaped guard exactly as `runTurn` composes it (isPi: true): decide() over an EMPTY
 *  stored-decision store (the dialog is the stored decisions' consumer, never the guard),
 *  then the grant ledger, consuming under the same redaction `handlePiGate` applied when the
 *  grant was recorded. */
function buildRelayGuard(
  permissionPlan: PermissionPlan,
  executionGrants: ApprovedExecutionGrants,
): RelayExecutionGuard {
  return buildRelayExecutionGuard({
    isPi: true,
    permissionPlan,
    executionGrants,
  });
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
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [input.spec],
      { endpoint: ENDPOINT, authorization: "ApiKey secret" },
      input.runContext,
      undefined,
      input.guard,
    );
    // Written AFTER startToolRelay: the stale-file sweep (whose listing is taken
    // synchronously inside startToolRelay for this synchronous-list host) clears any
    // request already present as pre-turn residue instead of executing it. A real
    // forged record can also only appear after the loop starts.
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({
        toolName: input.spec.name,
        toolCallId: id,
        args: input.args,
      }),
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

  it("no guard at all executes unconditionally (the relay itself never re-checks)", async () => {
    // Pins the relay-level contract: authorization lives entirely in the guard. `runTurn`
    // now builds a guard for EVERY harness, so a live run never hits this shape.
    const calls = stubFetch();

    const res = await relayOnce({ spec: askSpec(), args: { token: "T" } });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
  });

  it("(non-Pi) a forged record for a deny-policy tool is refused: the deny reason is the result, the executor never runs", async () => {
    const calls = stubFetch();
    const guard = buildRelayExecutionGuard({
      isPi: false,
      permissionPlan: ASK_PLAN,
      executionGrants: new ApprovedExecutionGrants(),
    });

    const res = await relayOnce({
      spec: askSpec({ permission: "deny" }),
      args: { token: "T" },
      guard,
    });

    assert.equal(res.ok, true, "a guard deny is a tool RESULT, not an error");
    assert.match(res.text ?? "", /denied by the permission policy/);
    assert.equal(calls.length, 0, "the forged record never executed");
  });

  it("(non-Pi) an allow tool executes with no grant", async () => {
    const calls = stubFetch();
    const guard = buildRelayExecutionGuard({
      isPi: false,
      permissionPlan: ASK_PLAN,
      executionGrants: new ApprovedExecutionGrants(),
    });

    const res = await relayOnce({
      spec: askSpec({ permission: "allow" }),
      args: {},
      guard,
    });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
  });

  it("(non-Pi) an `ask` tool executes WITHOUT any grant (the harness's own dialog is the ask gate)", async () => {
    // The documented residual of the MCP path: the runner cannot see the harness's ask
    // approvals, so the guard enforces only the deny boundary here — an `ask` record passes
    // with an EMPTY grant ledger, and nothing is consumed from it.
    const calls = stubFetch();
    const executionGrants = new ApprovedExecutionGrants();
    const guard = buildRelayExecutionGuard({
      isPi: false,
      permissionPlan: ASK_PLAN,
      executionGrants,
    });

    const res = await relayOnce({
      spec: askSpec(),
      args: { token: "T" },
      guard,
    });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1, "the ask tool executed with no grant");

    // The ledger stays untouched: a grant seeded by a Pi-style resume would survive.
    executionGrants.grant("park_probe", { token: "T" });
    const again = await relayOnce({
      spec: askSpec(),
      args: { token: "T" },
      guard,
    });
    assert.equal(again.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(
      executionGrants.consume("park_probe", { token: "T" }),
      true,
      "the non-Pi guard never consumed the grant",
    );
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
