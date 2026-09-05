import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { daytonaEnvVars } from "../../src/engines/sandbox_agent/daytona.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
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
