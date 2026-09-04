/**
 * Facet normalization: `DesiredEnvironmentState` (lifecycle migration, step 4).
 *
 * These tests pin two properties that the whole shadow router rests on.
 *
 *  1. FACET OWNERSHIP. Each request field lands in exactly one facet, and changing it moves that
 *     facet and no other. A field that moves two facets would make every plan over-broad.
 *  2. NO INPUT DRIFT. The facets cover exactly what `configFingerprint` covers. If a field is in
 *     the fingerprint but in no facet, the router would call a real change "no change" and the
 *     shadow comparison would be silently wrong.
 *
 * Run: pnpm exec vitest run tests/unit/lifecycle-desired-state.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { configFingerprint } from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  changedFacets,
  FACETS,
  normalizeDesiredState,
  type Facet,
} from "../../src/lifecycle/desired-state.ts";

const BASE: AgentRunRequest = {
  harness: "claude",
  model: "m1",
  sessionId: "s1",
  messages: [{ role: "user", content: "hello" }],
};

function digestsOf(request: AgentRunRequest) {
  return normalizeDesiredState(request, configFingerprint(request)).digests;
}

/** The facets that differ between `BASE` and `BASE + overrides`. */
function movedBy(overrides: Partial<AgentRunRequest>): Facet[] {
  return changedFacets(digestsOf({ ...BASE, ...overrides }), digestsOf(BASE));
}

describe("facet ownership: one field moves exactly one facet", () => {
  const cases: Array<{
    what: string;
    overrides: Partial<AgentRunRequest>;
    facet: Facet;
  }> = [
    {
      what: "the sandbox provider",
      overrides: { sandbox: "daytona" },
      facet: "sandbox",
    },
    {
      what: "the harness kind",
      overrides: { harness: "pi" },
      facet: "sandbox",
    },
    {
      what: "the sandbox permission",
      overrides: { sandboxPermission: "none" as never },
      facet: "sandbox",
    },
    {
      what: "the model connection",
      overrides: {
        modelConnection: {
          provider: "openai",
          deployment: "direct",
          credentialMode: "env",
          credentials: [],
        } as never,
      },
      facet: "runtime",
    },
    {
      what: "the instructions",
      overrides: { agentsMd: "new instructions" },
      facet: "workspaceFiles",
    },
    {
      what: "the system prompt",
      overrides: { systemPrompt: "sp" },
      facet: "prompts",
    },
    {
      what: "the skills",
      overrides: {
        skills: [{ name: "s", description: "d", body: "b" }] as never,
      },
      facet: "workspaceFiles",
    },
    {
      what: "the harness files",
      overrides: { harnessFiles: [{ path: "a", content: "b" }] as never },
      facet: "harnessFiles",
    },
    { what: "the model", overrides: { model: "m2" }, facet: "model" },
    {
      what: "the permissions",
      overrides: { permissions: { default: "deny" } as never },
      facet: "harnessSession",
    },
    {
      what: "the MCP servers",
      overrides: { mcpServers: [{ name: "x", connection: {} }] as never },
      facet: "harnessSession",
    },
    {
      what: "the custom tools",
      overrides: { customTools: [{ name: "t" }] as never },
      facet: "toolCatalog",
    },
    // The tool callback endpoint left this table with audit finding 5: it is read from the
    // incoming request every turn, so it moves NO facet. The per-turn-volatile suite below
    // pins that instead.
  ];

  for (const { what, overrides, facet } of cases) {
    it(`${what} moves only ${facet}`, () => {
      assert.deepEqual(
        movedBy(overrides),
        [facet],
        "a field that moves two facets makes every plan wider than the real change",
      );
    });
  }
});

describe("facet normalization: stability and coverage", () => {
  it("an identical request produces identical digests", () => {
    assert.deepEqual(digestsOf(BASE), digestsOf(BASE));
  });

  it("nothing changed means no facet changed", () => {
    assert.deepEqual(changedFacets(digestsOf(BASE), digestsOf(BASE)), []);
  });

  it("a missing applied state reports EVERY facet as changed", () => {
    // The cold-miss case. There is no environment, so nothing has been applied.
    assert.deepEqual(changedFacets(digestsOf(BASE), undefined), [...FACETS]);
  });

  it("reordering object keys does not change a digest", () => {
    const a: AgentRunRequest = { ...BASE, model: "m1", harness: "claude" };
    const b: AgentRunRequest = { harness: "claude", model: "m1", ...BASE };
    assert.deepEqual(digestsOf(a), digestsOf(b));
  });

  it("a per-turn volatile moves NO facet", () => {
    // Messages, turn ids, and trace propagation are per-turn data. If any of them moved a facet,
    // every single turn would look like a configuration change.
    for (const overrides of [
      { messages: [{ role: "user" as const, content: "different" }] },
      { turnId: "another-turn" },
      { context: { propagation: { traceparent: "00-abc-def-01" } } as never },
      // The resolved model's input modalities ride the request per turn and change with the
      // model; hashing them refused the live route on any cross-modality model switch.
      { modelCapabilities: { inputModalities: ["text"] } as never },
      // The rest of runContext is per-turn metadata: a committed revision or a trace id must
      // never evict. Only `workflow.artifact.id` is identity (it selects the agent mount).
      {
        runContext: {
          workflow: {
            revision: { id: "rev-2", version: "7" },
            variant: { id: "var-2" },
          },
          trace: { trace_id: "abc" },
        } as never,
      },
      // The per-deployment gateway URL is read from the incoming request every turn
      // (finding 5); a moved deployment must not evict every warm session.
      { toolCallback: { endpoint: "https://gateway-2/tools/call" } as never },
      // Generated platform text is fixed when an environment is built. It intentionally stays
      // outside both identity views so an integration change does not evict a warm session.
      { platformInstructions: "new generated platform text" },
      // Rolling-deployment compatibility has the same identity behavior as its replacement.
      {
        gatewayGuidance: {
          text: "legacy generated guidance",
          carrier: "agentsMd" as const,
        },
      },
    ]) {
      const label = JSON.stringify(overrides).slice(0, 40);
      assert.deepEqual(movedBy(overrides), [], label);
      // BOTH identity views must ignore a volatile: a field that sneaks back into the
      // fingerprint alone would cold-evict every warm session while this facet probe
      // stayed green (Codex review of the finding-5 change).
      assert.equal(
        configFingerprint({ ...BASE, ...overrides } as AgentRunRequest),
        configFingerprint(BASE),
        `fingerprint moved: ${label}`,
      );
    }
  });

  it("omitted MCP credentials equal an empty credential array, in BOTH views", () => {
    // The facet digest normalized an omitted array to [] while the fingerprint kept the
    // omission, so two identical requests disagreed in one view only: a cold evict with an
    // empty live plan and a DISAGREE log (Codex review of the finding-3 change).
    const server = { name: "s", connection: { url: "https://mcp.test" } };
    const omitted = {
      ...BASE,
      mcpServers: [server],
    } as never as AgentRunRequest;
    const empty = {
      ...BASE,
      mcpServers: [
        { ...server, connection: { ...server.connection, credentials: [] } },
      ],
    } as never as AgentRunRequest;
    assert.equal(configFingerprint(omitted), configFingerprint(empty));
    assert.deepEqual(digestsOf(omitted), digestsOf(empty));
  });

  it("the fingerprint and the facets agree about harness-mode changes (finding 3)", () => {
    // The fingerprint normalized the Codex mode while the facet took it raw, so an
    // explicitly-sent default moved `harnessSession` but not the fingerprint — and a session
    // poisoned that way rebuilt on every later mixed plan. Both views now share one
    // normalizer; this pins the agreement in BOTH directions.
    const codex = { ...BASE, harness: "codex" } as AgentRunRequest;
    const agree = (a: AgentRunRequest, b: AgentRunRequest, why: string) => {
      const fpMoved = configFingerprint(a) !== configFingerprint(b);
      const facetsMoved =
        JSON.stringify(digestsOf(a)) !== JSON.stringify(digestsOf(b));
      assert.equal(fpMoved, facetsMoved, why);
      return fpMoved;
    };
    assert.equal(
      agree(
        codex,
        { ...codex, harnessMode: "agent-full-access" },
        "explicit default",
      ),
      false,
      "an explicitly-sent default equals an absent field in both views",
    );
    assert.equal(
      agree(codex, { ...codex, harnessMode: "read-only" }, "real mode change"),
      true,
      "a real Codex mode change moves both views",
    );
    assert.equal(
      agree(
        BASE,
        { ...BASE, harnessMode: "read-only" } as AgentRunRequest,
        "non-codex",
      ),
      false,
      "a mode on a harness that ignores it moves neither view",
    );
  });

  it("NO INPUT DRIFT: a field that moves the fingerprint also moves a facet", () => {
    // The load-bearing invariant. The shadow comparison is only meaningful when the facets see
    // exactly what the fingerprint sees. A field in the fingerprint but in no facet would make
    // the router report "no change" on a real change.
    const probes: Array<[string, Partial<AgentRunRequest>]> = [
      ["sandbox", { sandbox: "daytona" }],
      ["harness", { harness: "pi" }],
      [
        "runContext.workflow.artifact.id",
        { runContext: { workflow: { artifact: { id: "art-2" } } } } as never,
      ],
      ["model", { model: "m2" }],
      ["agentsMd", { agentsMd: "x" }],
      ["systemPrompt", { systemPrompt: "x" }],
      ["appendSystemPrompt", { appendSystemPrompt: "x" }],
      [
        "skills",
        { skills: [{ name: "s", description: "d", body: "b" }] as never },
      ],
      ["customTools", { customTools: [{ name: "t" }] as never }],
      [
        "harnessFiles",
        { harnessFiles: [{ path: "a", content: "b" }] as never },
      ],
      ["permissions", { permissions: { default: "deny" } as never }],
      ["sandboxPermission", { sandboxPermission: "none" as never }],
      ["mcpServers", { mcpServers: [{ name: "x", connection: {} }] as never }],
    ];

    for (const [name, overrides] of probes) {
      const changed =
        configFingerprint({ ...BASE, ...overrides }) !==
        configFingerprint(BASE);
      assert.ok(changed, `precondition: ${name} must move the fingerprint`);
      assert.notDeepEqual(
        movedBy(overrides),
        [],
        `${name} moves the fingerprint but no facet, so the router would miss it`,
      );
    }
  });

  it("credential VALUES never reach a facet digest", () => {
    // Facet digests are logged. A value that changed a digest would be an oracle for that value.
    // Rotation is the credential epoch's job, exactly as it is for `configFingerprint`.
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
    assert.deepEqual(
      changedFacets(
        digestsOf(withSecret("sk-a")),
        digestsOf(withSecret("sk-b")),
      ),
      [],
      "only the credential SHAPE is hashed, never its value",
    );
  });

  it("changed facets come back in FACETS order, which is the apply order", () => {
    const moved = changedFacets(
      digestsOf({ ...BASE, sandbox: "daytona", agentsMd: "x", model: "m2" }),
      digestsOf(BASE),
    );
    assert.deepEqual(moved, ["sandbox", "workspaceFiles", "model"]);
  });

  it("SECURITY: harness files never share a facet with instructions or skills", () => {
    // The blocker that forced the facet split. `adapter-matrix.md` section 4.3.2 rule 3 puts
    // harness PERMISSION files on the never-apply-live list, and the runner cannot tell one
    // harness file from another. If they shared `workspaceFiles`, making that facet live would
    // silently route a permission change through an in-place refresh.
    assert.deepEqual(movedBy({ agentsMd: "x" }), ["workspaceFiles"]);
    assert.deepEqual(
      movedBy({ harnessFiles: [{ path: "a", content: "b" }] as never }),
      ["harnessFiles"],
    );
  });

  it("SECURITY: permissions never share a facet with the model", () => {
    // Same reasoning on the session side. Section 1.4 exempts permission TIGHTENING from
    // apply-live entirely, so a permissions change must not ride the `setModel` route.
    assert.deepEqual(movedBy({ model: "m2" }), ["model"]);
    assert.deepEqual(movedBy({ permissions: { default: "deny" } as never }), [
      "harnessSession",
    ]);
  });
});
