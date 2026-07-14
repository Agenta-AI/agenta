/**
 * Unit tests for the shared spec-schema helpers (tools/spec-schema.ts).
 *
 * These back the single source of truth for reading a tool's input schema (camelCase
 * `inputSchema` OR snake-case `input_schema`) and validating required arguments, after the
 * byte-identical copies in dispatch.ts / relay.ts / extensions/agenta.ts were collapsed here.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/spec-schema.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  assertRequiredArguments,
  missingRequiredFields,
  requiredFields,
  specInputSchema,
} from "../../src/tools/spec-schema.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

describe("specInputSchema", () => {
  it("reads camelCase inputSchema", () => {
    const spec = {
      name: "t",
      inputSchema: { type: "object", properties: { a: { type: "string" } } },
    } as ResolvedToolSpec;
    assert.deepEqual(specInputSchema(spec), {
      type: "object",
      properties: { a: { type: "string" } },
    });
  });

  it("falls back to snake-case input_schema (un-normalized platform-catalog shape)", () => {
    const spec = {
      name: "request_connection",
      kind: "client",
      input_schema: {
        type: "object",
        required: ["integration"],
        properties: { integration: { type: "string" } },
      },
    } as unknown as ResolvedToolSpec;
    assert.deepEqual(specInputSchema(spec), {
      type: "object",
      required: ["integration"],
      properties: { integration: { type: "string" } },
    });
  });

  it("prefers camelCase when both are present", () => {
    const spec = {
      name: "t",
      inputSchema: { type: "object", title: "camel" },
      input_schema: { type: "object", title: "snake" },
    } as unknown as ResolvedToolSpec;
    assert.equal((specInputSchema(spec) as Record<string, unknown>).title, "camel");
  });
});

describe("requiredFields", () => {
  it("returns declared required field names, ignoring non-string entries", () => {
    assert.deepEqual(
      requiredFields({ type: "object", required: ["a", 1, "b", null] }),
      ["a", "b"],
    );
  });

  it("returns [] when required is absent or the schema is not an object node", () => {
    assert.deepEqual(requiredFields({ type: "object" }), []);
    assert.deepEqual(requiredFields(undefined), []);
    assert.deepEqual(requiredFields([1, 2]), []);
  });
});

describe("missingRequiredFields", () => {
  it("flags a missing top-level required field", () => {
    const schema = { type: "object", required: ["a", "b"], properties: {} };
    assert.deepEqual(missingRequiredFields(schema, { a: 1 }), ["b"]);
  });

  it("treats null/undefined values as missing", () => {
    const schema = { type: "object", required: ["a"] };
    assert.deepEqual(missingRequiredFields(schema, { a: null }), ["a"]);
    assert.deepEqual(missingRequiredFields(schema, {}), ["a"]);
  });

  it("walks nested objects and reports dotted paths", () => {
    const schema = {
      type: "object",
      required: ["outer"],
      properties: {
        outer: {
          type: "object",
          required: ["inner"],
          properties: { inner: { type: "string" } },
        },
      },
    };
    // outer present but its required `inner` is missing -> dotted path.
    assert.deepEqual(missingRequiredFields(schema, { outer: {} }), [
      "outer.inner",
    ]);
    // outer itself missing -> only the outer path (no descent).
    assert.deepEqual(missingRequiredFields(schema, {}), ["outer"]);
    // fully populated -> nothing missing.
    assert.deepEqual(
      missingRequiredFields(schema, { outer: { inner: "x" } }),
      [],
    );
  });
});

describe("assertRequiredArguments", () => {
  it("throws a model-actionable error naming the missing fields", () => {
    const spec = {
      name: "request_connection",
      input_schema: { type: "object", required: ["integration"] },
    } as unknown as ResolvedToolSpec;
    assert.throws(
      () => assertRequiredArguments(spec, {}),
      /missing required argument\(s\): integration/,
    );
  });

  it("does not throw when all required args are present (snake-case schema)", () => {
    const spec = {
      name: "request_connection",
      input_schema: { type: "object", required: ["integration"] },
    } as unknown as ResolvedToolSpec;
    assert.doesNotThrow(() =>
      assertRequiredArguments(spec, { integration: "slack" }),
    );
  });
});
