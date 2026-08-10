/**
 * The tool-catalog generation (slice S3b).
 *
 * Contract: `adapter-matrix.md` section 2.4, consumed by `execution-authorization.md` section 8.
 *
 * The generation is what makes an authorization mean something over time. A tool named
 * `commit_revision` under generation N may have a different schema, permission, or execution
 * binding under N+1, so an approval minted under N must not authorize a call that would now run
 * differently. The rule the tests below pin: INCLUDE what changes the meaning of a call, EXCLUDE
 * what merely rotates — a field that changes on an ordinary turn would kill every parked
 * approval for no security gain.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/catalog-generation.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { computeCatalogGeneration } from "../../src/tools/catalog-generation.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

function spec(overrides: Partial<ResolvedToolSpec> = {}): ResolvedToolSpec {
  return {
    name: "commit_revision",
    description: "Commit a change.",
    inputSchema: { type: "object" },
    readOnly: false,
    permission: "ask",
    call: { method: "POST", path: "/api/workflows/revisions/commit" },
    timeoutMs: 15000,
    ...overrides,
  };
}

describe("what changes the generation", () => {
  it("is stable for the same catalog", () => {
    assert.equal(
      computeCatalogGeneration([spec()]),
      computeCatalogGeneration([spec()]),
    );
  });

  it("ignores the order tools arrive in", () => {
    const a = spec({ name: "a" });
    const b = spec({ name: "b" });
    assert.equal(
      computeCatalogGeneration([a, b]),
      computeCatalogGeneration([b, a]),
    );
  });

  it("moves when a tool is added or removed", () => {
    assert.notEqual(
      computeCatalogGeneration([spec()]),
      computeCatalogGeneration([spec(), spec({ name: "other" })]),
    );
  });

  it("moves on a model-visible change (description, schema, readOnly)", () => {
    const base = computeCatalogGeneration([spec()]);
    assert.notEqual(
      base,
      computeCatalogGeneration([spec({ description: "x" })]),
    );
    assert.notEqual(
      base,
      computeCatalogGeneration([spec({ inputSchema: { type: "string" } })]),
    );
    assert.notEqual(base, computeCatalogGeneration([spec({ readOnly: true })]));
  });

  it("moves on an execution-plan-only change the model never sees", () => {
    const base = computeCatalogGeneration([spec()]);
    // Nothing model-visible changed in any of these, and each still changes what the call MEANS.
    assert.notEqual(
      base,
      computeCatalogGeneration([spec({ timeoutMs: 30000 })]),
      "timeoutMs",
    );
    assert.notEqual(
      base,
      computeCatalogGeneration([spec({ permission: "allow" })]),
      "permission",
    );
    assert.notEqual(
      base,
      computeCatalogGeneration([
        spec({ call: { method: "POST", path: "/api/elsewhere" } }),
      ]),
      "dispatchTarget",
    );
    assert.notEqual(
      base,
      computeCatalogGeneration([
        spec({
          call: {
            method: "POST",
            path: "/api/workflows/revisions/commit",
            body: { fixed: 1 },
          },
        }),
      ]),
      "staticBodyDigest",
    );
    assert.notEqual(
      base,
      computeCatalogGeneration([
        spec({
          call: {
            method: "POST",
            path: "/api/workflows/revisions/commit",
            args_into: "payload",
          },
        }),
      ]),
      "argsIntoPath",
    );
  });

  it("moves when a binding is rewired to a different source at the SAME destination", () => {
    const destination = "workflow_revision.workflow_variant_id";
    const fromVariant = computeCatalogGeneration([
      spec({
        call: {
          method: "POST",
          path: "/api/workflows/revisions/commit",
          context: { [destination]: "$ctx.workflow.variant.id" },
        },
      }),
    ]);
    const fromArtifact = computeCatalogGeneration([
      spec({
        call: {
          method: "POST",
          path: "/api/workflows/revisions/commit",
          context: { [destination]: "$ctx.workflow.artifact.id" },
        },
      }),
    ]);
    assert.notEqual(
      fromVariant,
      fromArtifact,
      "hashing destinations alone would miss this: the same slot now carries a different entity",
    );
  });

  it("does not move for a JSON-looking description that differs only by type", () => {
    // The strict serializer never parses a string, so these two cannot collide.
    assert.notEqual(
      computeCatalogGeneration([spec({ description: '{"x":1}' })]),
      computeCatalogGeneration([spec({ description: '{"x":1}}}' })]),
    );
  });
});
