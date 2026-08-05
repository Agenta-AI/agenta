/**
 * Plan construction and shadow logging (lifecycle migration, step 4).
 *
 * The plan is a VALUE. Building one runs nothing and needs no environment, which is what makes
 * shadow routing testable at all: these tests assert on the plan and on the log line, and no
 * sandbox exists anywhere in this file.
 *
 * Run: pnpm exec vitest run tests/unit/lifecycle-reconcile-plan.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { configFingerprint } from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  normalizeDesiredState,
  type FacetDigests,
} from "../../src/lifecycle/desired-state.ts";
import {
  ACTION_KINDS,
  buildPlan,
  formatPlan,
  maxAction,
  type ReconcileAction,
} from "../../src/lifecycle/reconcile-plan.ts";
import {
  capabilitiesFor,
  harnessKind,
  logReconcileShadow,
  planReconcile,
} from "../../src/lifecycle/reconciliation-router.ts";

const BASE: AgentRunRequest = {
  harness: "claude",
  model: "m1",
  sessionId: "s1",
  messages: [{ role: "user", content: "hello" }],
};

function digestsOf(request: AgentRunRequest): FacetDigests {
  return normalizeDesiredState(request, configFingerprint(request)).digests;
}

function planFor(overrides: Partial<AgentRunRequest>, from: AgentRunRequest = BASE) {
  const request = { ...from, ...overrides };
  const desired = normalizeDesiredState(request, configFingerprint(request));
  return planReconcile(request, desired, digestsOf(from));
}

describe("the action vocabulary", () => {
  it("carries apply-live as a first-class kind even though v1 never emits it", () => {
    // The expressibility directive: per-harness live routes must be cheap to ENABLE later, so the
    // vocabulary carries the full range now and the capability table decides what is reachable.
    assert.ok(ACTION_KINDS.includes("apply-live"));
  });

  it("is ordered cheapest to most expensive, which maxAction relies on", () => {
    assert.deepEqual(
      [...ACTION_KINDS],
      [
        "no-op",
        "apply-live",
        "refresh-workspace",
        "reopen-session",
        "restart-runtime",
        "rebuild-sandbox",
      ],
    );
  });

  it("maxAction picks the most expensive action, not the last one", () => {
    const actions: ReconcileAction[] = [
      { facet: "sandbox", kind: "rebuild-sandbox", reason: "r" },
      { facet: "workspaceFiles", kind: "refresh-workspace", reason: "r" },
    ];
    assert.equal(maxAction(actions), "rebuild-sandbox");
    assert.equal(maxAction([]), "no-op");
  });

  it("only rebuild-sandbox forces a rebuild outcome", () => {
    for (const kind of ACTION_KINDS) {
      const plan = buildPlan([{ facet: "runtime", kind, reason: "r" }], ["runtime"]);
      assert.equal(
        plan.outcome,
        kind === "rebuild-sandbox" ? "rebuild" : "reuse",
        `${kind} keeps the sandbox unless it is a rebuild`,
      );
    }
  });
});

describe("plan construction per facet", () => {
  it("no change produces an empty plan", () => {
    const plan = planFor({});
    assert.deepEqual(plan.actions, []);
    assert.equal(plan.maxAction, "no-op");
    assert.equal(plan.outcome, "reuse");
  });

  it("a sandbox facet change rebuilds", () => {
    const plan = planFor({ sandbox: "daytona" });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["sandbox", "rebuild-sandbox"]],
    );
    assert.equal(plan.outcome, "rebuild");
  });

  it("a runtime facet change restarts the runtime and KEEPS the sandbox", () => {
    const plan = planFor({
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        credentialMode: "env",
        credentials: [],
      } as never,
    });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["runtime", "restart-runtime"]],
    );
    assert.equal(plan.outcome, "reuse", "a daemon restart does not need a new sandbox");
  });

  it("LIVE ROUTE 1: an instructions change refreshes the workspace in place", () => {
    const plan = planFor({ agentsMd: "new instructions" });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["workspaceFiles", "refresh-workspace"]],
    );
    assert.equal(plan.outcome, "reuse");
  });

  it("LIVE ROUTE 1: a skills change takes the same route", () => {
    const plan = planFor({
      skills: [{ name: "s", description: "d", body: "b" }] as never,
    });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["workspaceFiles", "refresh-workspace"]],
    );
  });

  it("LIVE ROUTE 2: a model change applies live", () => {
    const plan = planFor({ model: "m2" });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["model", "apply-live"]],
    );
    assert.equal(plan.outcome, "reuse");
  });

  it("NOT LIVE: a prompt change reopens, because observation is not guaranteed", () => {
    const plan = planFor({ systemPrompt: "sp" });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["prompts", "reopen-session"]],
    );
  });

  it("NOT LIVE: a harness-files change reopens, because they may be permission files", () => {
    const plan = planFor({
      harnessFiles: [{ path: "a", content: "b" }] as never,
    });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["harnessFiles", "reopen-session"]],
    );
  });

  it("NOT LIVE: a permissions change reopens, and never rides the model route", () => {
    const plan = planFor({ permissions: { default: "deny" } as never });
    assert.deepEqual(
      plan.actions.map((a) => [a.facet, a.kind]),
      [["harnessSession", "reopen-session"]],
    );
  });

  it("a tool-catalog change reopens the session on EVERY harness in v1", () => {
    // The PR-review decision: uniform behavior beats a split where two harnesses go live and the
    // third breaks the pattern. Flipping one harness later is a change to this capability table.
    for (const harness of ["pi", "claude", "codex"] as const) {
      const from = { ...BASE, harness };
      const plan = planFor({ customTools: [{ name: "t" }] as never }, from);
      assert.deepEqual(
        plan.actions.map((a) => [a.facet, a.kind]),
        [["toolCatalog", "reopen-session"]],
        `${harness} routes a tool change to a session reopen`,
      );
    }
  });

  it("EXACTLY TWO live routes, uniformly across every harness", () => {
    // DELIBERATE EDIT. This test used to assert that NO harness declared apply-live, which was
    // right when the router was pure shadow. Step 4 authorizes exactly two routes: the model and
    // the runner-owned workspace files. Everything else must still escalate, and that half of the
    // assertion is the part that matters — it is what stops a third route appearing by accident.
    for (const harness of ["pi", "claude", "codex"] as const) {
      const c = capabilitiesFor({ ...BASE, harness });
      assert.equal(c.model, "apply-live", harness);
      assert.equal(c.workspaceFiles, "refresh-workspace", harness);

      assert.equal(c.prompts, "reopen-session", harness);
      assert.equal(c.harnessFiles, "reopen-session", harness);
      assert.equal(c.harnessSession, "reopen-session", harness);
      assert.equal(c.toolCatalog, "reopen-session", harness);
    }
  });

  it("no capability is live beyond the two authorized routes", () => {
    // The guard against scope creep. Count the live kinds rather than name them, so a new
    // capability field added later cannot quietly become the third live route.
    for (const harness of ["pi", "claude", "codex"] as const) {
      const c = capabilitiesFor({ ...BASE, harness }) as unknown as Record<
        string,
        string
      >;
      const live = Object.entries(c).filter(
        ([, kind]) => kind === "apply-live" || kind === "refresh-workspace",
      );
      assert.equal(live.length, 2, `${harness} must have exactly two live routes`);
    }
  });

  it("an unknown harness fails closed to a rebuild", () => {
    assert.equal(harnessKind({ ...BASE, harness: "future-thing" } as never), "unknown");
    const capabilities = capabilitiesFor({ ...BASE, harness: "future-thing" } as never);
    assert.equal(capabilities.toolCatalog, "rebuild-sandbox");
    assert.equal(capabilities.workspaceFiles, "rebuild-sandbox");
    assert.equal(capabilities.model, "rebuild-sandbox");
  });

  it("several changed facets produce one action each, in apply order", () => {
    const plan = planFor({ sandbox: "daytona", agentsMd: "x", model: "m2" });
    assert.deepEqual(
      plan.actions.map((a) => a.facet),
      ["sandbox", "workspaceFiles", "model"],
      "the order is the dependency order: a workspace refresh must land before a reopen",
    );
    assert.equal(plan.maxAction, "rebuild-sandbox");
  });

  it("no applied state at all is a rebuild, which is the cold-miss case", () => {
    const desired = normalizeDesiredState(BASE, configFingerprint(BASE));
    const plan = planReconcile(BASE, desired, undefined);
    assert.equal(plan.outcome, "rebuild");
    assert.equal(plan.changedFacets.length, 8);
  });

  it("formatPlan prints facet names and action kinds only", () => {
    const plan = planFor({ agentsMd: "x" });
    assert.equal(formatPlan(plan), "workspaceFiles=refresh-workspace");
    assert.equal(formatPlan(planFor({})), "none");
  });
});

describe("shadow logging", () => {
  function capture(input: Parameters<typeof logReconcileShadow>[0]) {
    const lines: string[] = [];
    const plan = logReconcileShadow({ ...input, log: (m) => lines.push(m) });
    return { lines, plan };
  }

  const shadowInput = (
    request: AgentRunRequest,
    applied: FacetDigests | undefined,
    decision: "reuse" | "rebuild",
    decisionReason: string,
  ) => ({
    key: "proj-1:s1",
    request,
    configFingerprint: configFingerprint(request),
    appliedFingerprint: applied ? "applied-fp" : undefined,
    appliedDigests: applied,
    decision,
    decisionReason,
  });

  it("marks AGREEMENT when the plan matches the coordinator", () => {
    // Nothing changed and the coordinator reused: the plan says reuse too.
    const { lines } = capture(shadowInput(BASE, digestsOf(BASE), "reuse", "hit-continue"));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\bagree\b/);
    assert.doesNotMatch(lines[0], /DISAGREE/);
    assert.match(lines[0], /decision=reuse\(hit-continue\)/);
    assert.match(lines[0], /plan=reuse\(no-op\)/);
  });

  it("marks DISAGREEMENT, greppably, when the plan differs", () => {
    // The coordinator rebuilds on ANY config change. The router says a changed instruction only
    // needs a workspace refresh. That gap is the whole point of the shadow period.
    const request = { ...BASE, agentsMd: "new instructions" };
    const { lines, plan } = capture(
      shadowInput(request, digestsOf(BASE), "rebuild", "mismatch:config"),
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0], /DISAGREE/);
    assert.match(lines[0], /decision=rebuild\(mismatch:config\)/);
    assert.match(lines[0], /plan=reuse\(refresh-workspace\)/);
    assert.match(lines[0], /facets=\[workspaceFiles=refresh-workspace\]/);
    assert.equal(plan?.outcome, "reuse");
  });

  it("agrees with the coordinator on a genuine sandbox change", () => {
    const request = { ...BASE, sandbox: "daytona" };
    const { lines } = capture(
      shadowInput(request, digestsOf(BASE), "rebuild", "mismatch:config"),
    );
    assert.match(lines[0], /\bagree\b/);
    assert.match(lines[0], /plan=rebuild\(rebuild-sandbox\)/);
  });

  it("agrees on a cold miss: no environment means a rebuild", () => {
    const { lines } = capture(shadowInput(BASE, undefined, "rebuild", "miss"));
    assert.match(lines[0], /\bagree\b/);
    assert.match(lines[0], /decision=rebuild\(miss\)/);
  });

  it("logs NO configuration, digest, or credential content", () => {
    const request: AgentRunRequest = {
      ...BASE,
      agentsMd: "SECRET-INSTRUCTION-TEXT",
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value: "sk-SECRET-VALUE",
            usage: "opaque_http",
          },
        ],
      } as never,
    };
    const desired = normalizeDesiredState(request, configFingerprint(request));
    const { lines } = capture(
      shadowInput(request, digestsOf(BASE), "rebuild", "mismatch:config"),
    );
    const line = lines[0];
    assert.doesNotMatch(line, /SECRET-INSTRUCTION-TEXT/);
    assert.doesNotMatch(line, /sk-SECRET-VALUE/);
    assert.doesNotMatch(line, /OPENAI_API_KEY/);
    // Not even a digest: a digest of a small field space is guessable, so none are logged.
    for (const digest of Object.values(desired.digests)) {
      assert.ok(!line.includes(digest), "a facet digest must never reach the log");
    }
    assert.ok(!line.includes(configFingerprint(request)));
  });

  it("never throws, and never fails the turn, when the router blows up", () => {
    // A shadow component that can break the thing it shadows is worse than no shadow.
    const broken = {
      ...shadowInput(BASE, digestsOf(BASE), "reuse", "hit-continue"),
      request: null as unknown as AgentRunRequest,
    };
    const { lines, plan } = capture(broken);
    assert.equal(plan, undefined);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /shadow failed/);
  });

  it("KNOWN GAP: a rotated credential moves NO facet, so the router plans a no-op", () => {
    // Found by running the shadow, which is what the shadow is for. This disagreement means the
    // ROUTER IS WRONG, and it is security-relevant.
    //
    // Credential values are excluded from every facet digest on purpose, because digests are
    // logged. So a rotated secret is invisible to the router. Rotation is tracked by the
    // credential EPOCH, a separate timing-safe comparison the router does not read.
    //
    // This test pins the gap so it cannot be forgotten. When step 5 feeds the epoch into the
    // plan, this test must be rewritten to expect `restart-runtime`. Until then the router must
    // never be made authoritative: it would reuse a daemon holding a revoked credential.
    const withSecret = (value: string): AgentRunRequest => ({
      ...BASE,
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.openai.com/v1" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value,
            usage: "opaque_http",
          },
        ],
      } as never,
    });

    const { lines, plan } = capture(
      shadowInput(
        withSecret("sk-b"),
        digestsOf(withSecret("sk-a")),
        "rebuild",
        "mismatch:credentials-rotated",
      ),
    );
    assert.deepEqual(plan?.changedFacets, [], "the rotation is invisible to the facets");
    assert.match(lines[0], /DISAGREE/);
    assert.match(lines[0], /plan=reuse\(no-op\)/);
  });

  it("KNOWN GAP: an edited transcript moves no facet, and here the ROUTER is right", () => {
    // The other disagreement the shadow surfaced. A wrong transcript says nothing about the
    // environment, which is why step 1 gave it a teardown reason that PARKS the sandbox. Closing
    // this one means teaching the coordinator that a continuity failure needs a fresh
    // conversation, not a fresh environment. That is a behavior change, so it waits for step 6.
    const { lines, plan } = capture(
      shadowInput(BASE, digestsOf(BASE), "rebuild", "mismatch:history"),
    );
    assert.deepEqual(plan?.changedFacets, []);
    assert.match(lines[0], /DISAGREE/);
    assert.match(lines[0], /decision=rebuild\(mismatch:history\)/);
  });

  it("returns the plan, so a caller can assert without reading stderr", () => {
    const { plan } = capture(
      shadowInput({ ...BASE, model: "m2" }, digestsOf(BASE), "rebuild", "mismatch:config"),
    );
    assert.deepEqual(plan?.changedFacets, ["model"]);
  });
});
