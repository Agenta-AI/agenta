/**
 * Regression: the Agenta Pi extension registers custom tools from AGENTA_TOOL_PUBLIC_SPECS.
 *
 * Guards QA finding F-005 (docs/design/agent-workflows/qa/findings.md): a build where the
 * extension stopped reading AGENTA_TOOL_PUBLIC_SPECS shipped custom tools that the model never
 * saw, so it improvised with bash and failed. This pins the contract at the source: given the
 * public-spec env the runner sets (buildPiExtensionEnv in engines/sandbox_agent.ts), the extension
 * factory calls pi.registerTool once per spec, passes the JSON Schema through, and gives each
 * tool an execute() that relays to the runner. It is also inert when the env is absent.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/extension-tools.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import factory from "../../src/extensions/agenta.ts";

const TOOL_ENV = [
  "AGENTA_TOOL_PUBLIC_SPECS",
  "AGENTA_TOOL_RELAY_DIR",
  "AGENTA_TRACEPARENT",
  "AGENTA_OTLP_ENDPOINT",
  "AGENTA_USAGE_OUT",
  "AGENTA_CAPTURE_CONTENT",
];

function fakePi() {
  const registered: any[] = [];
  return {
    registered,
    registerTool(spec: any) {
      registered.push(spec);
    },
    on() {},
  };
}

function clearEnv() {
  for (const key of TOOL_ENV) delete process.env[key];
}

afterEach(clearEnv);

describe("agenta extension tool registration", () => {
  it("registers one tool per public spec, schema passed through", () => {
    clearEnv();
    process.env.AGENTA_TOOL_PUBLIC_SPECS = JSON.stringify([
      {
        name: "secret_math",
        description: "qa math",
        inputSchema: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
      },
      { name: "no_schema_tool", description: "no schema" },
    ]);
    process.env.AGENTA_TOOL_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.equal(pi.registered.length, 2, "registers one tool per public spec");
    assert.deepEqual(
      pi.registered.map((t) => t.name),
      ["secret_math", "no_schema_tool"],
      "registers each spec by name",
    );

    const math = pi.registered[0];
    assert.equal(math.description, "qa math", "carries the description");
    assert.ok(
      math.parameters && math.parameters.properties && math.parameters.properties.x,
      "passes the JSON Schema through to Pi",
    );
    assert.equal(typeof math.execute, "function", "each tool has an execute() that relays");

    const noSchema = pi.registered[1];
    assert.ok(
      noSchema.parameters,
      "a spec without inputSchema falls back to a schema, never undefined",
    );
  });

  it("is inert without the tool env (the F-005 bug shape: never delivered)", () => {
    clearEnv();
    const pi = fakePi();
    factory(pi as any);
    assert.equal(
      pi.registered.length,
      0,
      "no tool env => registers nothing (no silent partial state)",
    );
  });

  it("does not register when specs are present but the relay dir is missing", () => {
    clearEnv();
    process.env.AGENTA_TOOL_PUBLIC_SPECS = JSON.stringify([{ name: "x" }]);
    const pi = fakePi();
    factory(pi as any);
    assert.equal(
      pi.registered.length,
      0,
      "specs without a relay dir do not register (incomplete wiring is not honored)",
    );
  });
});
