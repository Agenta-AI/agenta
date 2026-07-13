import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  assertDaytonaOpaqueSecretsEnabled,
  buildDaytonaSecretPlan,
  exactHttpsHost,
} from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";

afterEach(() => {
  delete process.env.AGENTA_DAYTONA_OPAQUE_SECRETS;
});

const modelConnection = {
  provider: "anthropic",
  deployment: "direct",
  endpoint: { baseUrl: "https://api.anthropic.com/v1/messages" },
  credentialMode: "env" as const,
  environment: { AWS_REGION: "us-east-1" },
  credentials: [
    {
      binding: { kind: "environment" as const, name: "ANTHROPIC_API_KEY" },
      value: "opaque-model-value",
      usage: "opaque_http" as const,
    },
  ],
};

describe("Daytona Secret planning", () => {
  it("plans exact hosts and keeps opaque values out of the direct environment", () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: {
        ...modelConnection,
        credentials: [
          ...modelConnection.credentials,
          {
            binding: {
              kind: "environment" as const,
              name: "AWS_PROFILE",
            },
            value: "local-only",
            usage: "local_use" as const,
          },
        ],
      },
      mcpServers: [
        {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app/rpc",
          credentials: [
            {
              binding: { kind: "header", name: "Authorization" },
              value: "opaque-mcp-value",
              usage: "opaque_http",
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      plan.candidates.map((candidate) => ({
        consumer: candidate.consumer,
        binding: candidate.binding.name,
        host: candidate.allowedHost,
      })),
      [
        {
          consumer: { kind: "model" },
          binding: "ANTHROPIC_API_KEY",
          host: "api.anthropic.com",
        },
        {
          consumer: { kind: "http_mcp", server: "linear" },
          binding: "Authorization",
          host: "mcp.linear.app",
        },
      ],
    );
    assert.deepEqual(plan.environment, {
      AWS_REGION: "us-east-1",
      AWS_PROFILE: "local-only",
    });
    assert.equal(JSON.stringify(plan.environment).includes("opaque-"), false);
  });

  it("rejects IP literals, internal names, wildcards, credentials, and non-default ports", () => {
    for (const url of [
      "https://8.8.8.8/v1",
      "https://[2001:4860:4860::8888]/v1",
      "https://metadata.google.internal/v1",
      "https://metadata/v1",
      "https://localhost/v1",
      "https://*.example.com/v1",
      "https://user:pass@example.com/v1",
      "https://example.com:8443/v1",
    ]) {
      assert.throws(() => exactHttpsHost(url), /Invalid Daytona secret plan/);
    }
    assert.equal(
      exactHttpsHost("https://API.EXAMPLE.COM./v1"),
      "api.example.com",
    );
  });

  it("rejects reserved credential bindings", () => {
    assert.throws(
      () =>
        buildDaytonaSecretPlan({
          modelConnection: {
            ...modelConnection,
            credentials: [
              {
                ...modelConnection.credentials[0],
                binding: { kind: "environment", name: "DAYTONA_API_KEY" },
              },
            ],
          },
        }),
      /credential binding 'DAYTONA_API_KEY' is reserved/,
    );
  });

  it("fails closed on plaintext credential bypasses in model environment and local_use", () => {
    assert.throws(
      () =>
        buildDaytonaSecretPlan({
          modelConnection: {
            ...modelConnection,
            credentialMode: "none",
            environment: { ANTHROPIC_API_KEY: "plaintext-bypass" },
            credentials: [],
          },
        }),
      /not approved public config/,
    );
    assert.throws(
      () =>
        buildDaytonaSecretPlan({
          modelConnection: {
            ...modelConnection,
            credentials: [
              {
                binding: {
                  kind: "environment",
                  name: "ANTHROPIC_API_KEY",
                },
                value: "plaintext-bypass",
                usage: "local_use",
              },
            ],
          },
        }),
      /not approved for local provider-SDK use/,
    );
  });

  it("secretizes every MCP header regardless of whether its name looks credential-like", () => {
    const plaintext = ["Bearer plaintext-bypass", "arbitrary-secret"];
    const plan = buildDaytonaSecretPlan({
      mcpServers: [
        {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app/rpc",
          headers: {
            Authorization: plaintext[0],
            "X-Foo": plaintext[1],
          },
          credentials: [
            {
              binding: { kind: "header", name: "X-Typed-Key" },
              value: "typed-secret",
              usage: "opaque_http",
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.binding.name),
      ["Authorization", "X-Foo", "X-Typed-Key"],
    );
    assert.equal(
      plaintext.some((value) =>
        JSON.stringify(plan.environment).includes(value),
      ),
      false,
    );
    assert.throws(
      () =>
        buildDaytonaSecretPlan({
          mcpServers: [
            {
              name: "bad",
              transport: "stdio",
              command: "server",
              headers: { Accept: "application/json" },
            },
          ],
        }),
      /require HTTP transport and URL/,
    );
  });

  it("keeps the feature default-off and accepts only the explicit process_local mode", () => {
    const plan = buildDaytonaSecretPlan({ modelConnection });
    assert.throws(
      () => assertDaytonaOpaqueSecretsEnabled(plan),
      /AGENTA_DAYTONA_OPAQUE_SECRETS=process_local/,
    );
    assert.doesNotThrow(() =>
      assertDaytonaOpaqueSecretsEnabled(plan, "process_local"),
    );
    assert.throws(() => assertDaytonaOpaqueSecretsEnabled(plan, "true"));
  });

  it("fails a Daytona run before cwd creation when the gate is off", () => {
    let created = false;
    const request = {
      harness: "claude",
      sandbox: "daytona",
      messages: [{ role: "user", content: "hello" }],
      modelConnection,
    } satisfies AgentRunRequest;
    const disabled = buildRunPlan(request, {
      createDaytonaCwd: () => {
        created = true;
        return "/unused";
      },
    });
    assert.equal(disabled.ok, false);
    assert.equal(created, false);

    process.env.AGENTA_DAYTONA_OPAQUE_SECRETS = "process_local";
    const enabled = buildRunPlan(request, {
      createDaytonaCwd: () => "/sandbox/cwd",
    });
    assert.equal(enabled.ok, true);
    if (!enabled.ok) return;
    assert.deepEqual(enabled.plan.modelEnvironment, {
      AWS_REGION: "us-east-1",
    });
    assert.equal(enabled.plan.hasApiKey, false);
    assert.equal(enabled.plan.daytonaSecretPlan?.candidates.length, 1);
  });
});
