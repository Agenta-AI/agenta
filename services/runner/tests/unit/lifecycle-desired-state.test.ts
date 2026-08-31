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
    {
      what: "the tool callback endpoint",
      overrides: {
        toolCallback: { endpoint: "https://gateway/tools/call" } as never,
      },
      facet: "toolCatalog",
    },
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
    ]) {
      assert.deepEqual(
        movedBy(overrides),
        [],
        JSON.stringify(overrides).slice(0, 40),
      );
    }
  });

  it("NO INPUT DRIFT: a field that moves the fingerprint also moves a facet", () => {
    // The load-bearing invariant. The shadow comparison is only meaningful when the facets see
    // exactly what the fingerprint sees. A field in the fingerprint but in no facet would make
    // the router report "no change" on a real change.
    const probes: Array<[string, Partial<AgentRunRequest>]> = [
      ["sandbox", { sandbox: "daytona" }],
      ["harness", { harness: "pi" }],
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
      [
        "toolCallback.endpoint",
        { toolCallback: { endpoint: "https://gateway/tools/call" } as never },
      ],
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
