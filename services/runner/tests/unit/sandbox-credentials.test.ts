import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { daytonaEnvVars } from "../../src/engines/sandbox_agent/daytona.ts";
import {
  buildRunPlan,
  materializeModelEnvironment,
} from "../../src/engines/sandbox_agent/run-plan.ts";
import {
  materializeSandboxCredentials,
  RESERVED_SANDBOX_CREDENTIAL_NAMES,
} from "../../src/engines/sandbox_agent/sandbox-credentials.ts";
import {
  computeCredentialEpoch,
  configFingerprint,
} from "../../src/engines/sandbox_agent/session-identity.ts";
import { normalizeDesiredState } from "../../src/lifecycle/desired-state.ts";
import { assignSandboxEnvironment } from "../../src/environment/runtime-lifecycle.ts";
import { seedForRun } from "../../src/redaction.ts";

function request(name = "GITHUB_TOKEN", value = "github-secret-value"): AgentRunRequest {
  return {
    messages: [{ role: "user", content: "hello" }],
    sandboxCredentials: [{ binding: { kind: "environment", name }, value }],
  };
}

describe("sandbox credentials", () => {
  it("validates and composes readable environment bindings for local and Daytona", () => {
    const result = materializeSandboxCredentials(request());
    assert.deepEqual(result, {
      ok: true,
      environment: { GITHUB_TOKEN: "github-secret-value" },
    });
    assert.equal(
      daytonaEnvVars({}, result.ok ? result.environment : {}).GITHUB_TOKEN,
      "github-secret-value",
    );
  });

  it("rejects malformed, duplicate, reserved, model, and MCP collisions", () => {
    const invalid = ["1TOKEN", "TOKEN-NAME", "TOKEN.NAME"];
    for (const name of invalid) assert.equal(materializeSandboxCredentials(request(name)).ok, false);

    for (const name of RESERVED_SANDBOX_CREDENTIAL_NAMES) {
      assert.equal(materializeSandboxCredentials(request(name)).ok, false, name);
    }

    const duplicate = request();
    duplicate.sandboxCredentials!.push({
      binding: { kind: "environment", name: "GITHUB_TOKEN" },
      value: "other",
    });
    assert.equal(materializeSandboxCredentials(duplicate).ok, false);

    const model = request();
    model.modelConnection = {
      provider: "openai",
      deployment: "direct",
      credentialMode: "env",
      environment: {},
      credentials: [{
        binding: { kind: "environment", name: "GITHUB_TOKEN" },
        value: "model-secret",
        usage: "opaque_http",
      }],
    };
    assert.equal(materializeSandboxCredentials(model).ok, false);

    for (const name of [
      "AGENTA_AGENT_FUTURE_CONTROL",
      "SANDBOX_AGENT_COMMAND",
      "PI_CODING_AGENT_FUTURE",
    ]) {
      assert.equal(materializeSandboxCredentials(request(name)).ok, false, name);
    }
  });


  it("does not treat MCP HTTP headers as environment collisions", () => {
    const mcp = request("Authorization");
    mcp.mcpServers = [{
      name: "server",
      connection: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "public" },
      },
      policy: { tools: { mode: "all" } },
    }];
    assert.deepEqual(materializeSandboxCredentials(mcp), {
      ok: true,
      environment: { Authorization: "github-secret-value" },
    });
  });

  it("rejects collisions with the final runner-owned environment before assignment", () => {
    const daemon = { ENABLE_TOOL_SEARCH: "false" };
    const extension = { PI_CODING_AGENT_SKILL_DIR: "/runner/skills" };
    assert.throws(
      () => assignSandboxEnvironment([daemon, extension], { ENABLE_TOOL_SEARCH: "secret" }),
      /runner-owned environment/,
    );
    assert.deepEqual(daemon, { ENABLE_TOOL_SEARCH: "false" });
    assert.throws(
      () => assignSandboxEnvironment([daemon, extension], { PI_CODING_AGENT_SKILL_DIR: "secret" }),
      /runner-owned environment/,
    );
    assert.deepEqual(extension, { PI_CODING_AGENT_SKILL_DIR: "/runner/skills" });
  });

  it("fails during plan construction before creating a sandbox cwd", () => {
    let created = false;
    const invalid = request("PATH");
    const result = buildRunPlan(invalid, {
      sandboxProvider: "local",
      enabledProviders: ["local"],
      createLocalCwd: () => {
        created = true;
        return "/tmp/should-not-exist";
      },
    });
    assert.equal(result.ok, false);
    assert.equal(created, false);
  });

  it("seeds custom values into known-value redaction", () => {
    const redactor = seedForRun(request());
    assert.doesNotMatch(
      redactor.redactString("token=github-secret-value", "test")!,
      /github-secret-value/,
    );
  });

  it("keeps values out of configuration identity and includes them in credential epochs", () => {
    const first = request("GITHUB_TOKEN", "first-secret-value");
    const rotated = request("GITHUB_TOKEN", "second-secret-value");
    const removed = request();
    delete removed.sandboxCredentials;

    assert.equal(configFingerprint(first), configFingerprint(rotated));
    assert.notEqual(configFingerprint(first), configFingerprint(removed));
    assert.ok(
      computeCredentialEpoch(first).direct.equals(computeCredentialEpoch(rotated).direct) === false,
    );
    assert.ok(
      computeCredentialEpoch(first).direct.equals(computeCredentialEpoch(removed).direct) === false,
    );

    const firstState = normalizeDesiredState(first, configFingerprint(first));
    const rotatedState = normalizeDesiredState(rotated, configFingerprint(rotated));
    assert.equal(firstState.digests.runtime, rotatedState.digests.runtime);
  });
});

describe("reserved environment names on the model connection (M20)", () => {
  function connectionRequest(
    environment: Record<string, string>,
    credentials?: unknown[],
  ): AgentRunRequest {
    return {
      modelConnection: {
        provider: "openai",
        deployment: "custom",
        endpoint: { baseUrl: "https://api.example.test/v1" },
        environment,
        ...(credentials
          ? { credentialMode: "env", credentials }
          : {}),
      },
    } as unknown as AgentRunRequest;
  }

  for (const name of [
    "AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "PATH",
  ]) {
    it(`refuses '${name}' on modelConnection.environment`, () => {
      // The screen was applied to `sandboxCredentials` only, while this field lands in the same
      // process environment — so it decided which field an override had to arrive in, not whether
      // one could. `AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE` is the sharp one: the bundled Pi
      // extension reads it and would re-point the model provider.
      const result = materializeModelEnvironment(
        connectionRequest({ [name]: "attacker-supplied" }),
      );
      assert.equal(result.ok, false);
      assert.match(
        result.ok ? "" : result.error,
        /reserved by the runtime/,
      );
    });
  }

  it("refuses a reserved name on a credential binding too", () => {
    // Same environment, a different field of the same object.
    const result = materializeModelEnvironment(
      connectionRequest({}, [
        {
          binding: { kind: "environment", name: "AGENTA_AGENT_BUILTIN_GATING" },
          value: "0",
          usage: "local_use",
        },
      ]),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /reserved by the runtime/);
  });

  it("still accepts an ordinary provider variable", () => {
    // The screen must not cost the field its actual purpose.
    const result = materializeModelEnvironment(
      connectionRequest({ OPENAI_BASE_URL: "https://api.example.test/v1" }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.environment, {
      OPENAI_BASE_URL: "https://api.example.test/v1",
    });
  });

  it("screens every name the sandbox credential path screens", () => {
    // One rule, one set: a name added to the reserved set must close both doors at once.
    for (const name of RESERVED_SANDBOX_CREDENTIAL_NAMES) {
      assert.equal(
        materializeModelEnvironment(connectionRequest({ [name]: "x" })).ok,
        false,
        `${name} should be refused on modelConnection.environment`,
      );
    }
  });
});
