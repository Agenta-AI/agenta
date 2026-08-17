import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { AgentRunRequest, McpServerConfig } from "../../src/protocol.ts";
import {
  assertDaytonaOpaqueSecretsEnabled,
  buildDaytonaSecretPlan,
  exactHttpsHost,
} from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

// The buildRunPlan case below exercises a Daytona run, so enable the provider (with a
// provisioning credential) on top of the hermetic scrub and drop the memoized config.
beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

afterEach(() => {
  delete process.env.AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS;
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
          connection: {
            type: "http",
            url: "https://mcp.linear.app/rpc",
            credentials: [
              {
                binding: { kind: "header", name: "Authorization" },
                value: "opaque-mcp-value",
                usage: "opaque_http",
              },
            ],
          },
          policy: { tools: { mode: "all" } },
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

  it("rejects an opaque model credential that collides with a direct environment binding", () => {
    // AWS_REGION rides `envVars` directly; a same-named (case-insensitive) Secret attachment
    // would put the binding in BOTH `envVars` and `secrets` with undefined precedence.
    assert.throws(
      () =>
        buildDaytonaSecretPlan({
          modelConnection: {
            ...modelConnection,
            credentials: [
              {
                binding: { kind: "environment", name: "aws_region" },
                value: "opaque-collides",
                usage: "opaque_http",
              },
            ],
          },
        }),
      /collides with a direct environment binding/,
    );
    // Wire order must not matter: an opaque credential listed BEFORE the same-named
    // local_use credential still collides (direct bindings settle first).
    assert.throws(
      () =>
        buildDaytonaSecretPlan({
          modelConnection: {
            ...modelConnection,
            environment: {},
            credentials: [
              {
                binding: { kind: "environment", name: "aws_profile" },
                value: "opaque-collides",
                usage: "opaque_http",
              },
              {
                binding: { kind: "environment", name: "AWS_PROFILE" },
                value: "local-only",
                usage: "local_use",
              },
            ],
          },
        }),
      /collides with a direct environment binding/,
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
          connection: {
            type: "http",
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
          policy: { tools: { mode: "all" } },
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
              connection: {
                type: "http",
                headers: { Accept: "application/json" },
              },
              policy: { tools: { mode: "all" } },
            } as unknown as McpServerConfig,
          ],
        }),
      /require a URL/,
    );
  });

  it("hides credentials by default, and only an explicit off value stops it", () => {
    const plan = buildDaytonaSecretPlan({ modelConnection });

    // Doing nothing gets you the protected behavior.
    assert.doesNotThrow(() => assertDaytonaOpaqueSecretsEnabled(plan));
    assert.doesNotThrow(() => assertDaytonaOpaqueSecretsEnabled(plan, ""));
    assert.doesNotThrow(() =>
      assertDaytonaOpaqueSecretsEnabled(plan, "process_local"),
    );

    // Only a recognized off value switches it off, in any case and with stray whitespace.
    for (const off of ["off", "false", "0", "no", "disabled", "plaintext"]) {
      assert.throws(
        () => assertDaytonaOpaqueSecretsEnabled(plan, off),
        /no plaintext fallback/,
        `'${off}' should switch hiding off`,
      );
    }
    assert.throws(() => assertDaytonaOpaqueSecretsEnabled(plan, "  OFF  "));

    // A typo must fail SAFE. Someone who meant to switch hiding off and mistyped keeps the
    // protection they would have had by doing nothing, rather than silently losing it.
    for (const typo of ["of", "flase", "disable", "true", "process-local"]) {
      assert.doesNotThrow(
        () => assertDaytonaOpaqueSecretsEnabled(plan, typo),
        `'${typo}' is not a recognized off value and must leave hiding on`,
      );
    }
  });

  it("hides credentials on a default Daytona run, and only when switched off does not", () => {
    const request = {
      harness: "claude",
      sandbox: "daytona",
      messages: [{ role: "user", content: "hello" }],
      modelConnection,
    } satisfies AgentRunRequest;

    // Switched OFF explicitly: behavior-identical to the pre-feature runner — the run proceeds
    // and the opaque key rides the plaintext model environment; no secret plan, no fail-closed.
    process.env.AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS = "off";
    const disabled = buildRunPlan(request, {
      createDaytonaCwd: () => "/sandbox/cwd",
    });
    assert.equal(disabled.ok, true);
    if (!disabled.ok) return;
    assert.equal(
      disabled.plan.credentials.modelEnvironment.ANTHROPIC_API_KEY,
      "opaque-model-value",
    );
    assert.equal(disabled.plan.credentials.daytonaSecretPlan, undefined);
    assert.equal(disabled.plan.credentials.hasApiKey, true);

    // ON, which is the default: the opaque value leaves the plaintext environment for the
    // secret plan. Unset rather than set, so this asserts the DEFAULT and not just the
    // explicit mode.
    delete process.env.AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS;
    const enabled = buildRunPlan(request, {
      createDaytonaCwd: () => "/sandbox/cwd",
    });
    assert.equal(enabled.ok, true);
    if (!enabled.ok) return;
    assert.deepEqual(enabled.plan.credentials.modelEnvironment, {
      AWS_REGION: "us-east-1",
    });
    // hasApiKey consults the FULL materialized environment: the opaque key left the plaintext
    // env for the secret plan, but the harness still receives it as a Secret attachment.
    assert.equal(enabled.plan.credentials.hasApiKey, true);
    assert.equal(enabled.plan.credentials.daytonaSecretPlan?.candidates.length, 1);
  });
});

describe("Daytona Secret plan for a gateway connection (WP13 Phase 3)", () => {
  it("is empty: no provider credentials to hide, since none were sent", () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: {
        provider: "openai",
        deployment: "custom",
        credentialMode: "none",
        credentials: [],
        endpoint: { baseUrl: "https://gateway.example.com/gateways/llms/standard/openai" },
        gatewayCredentials: {
          header: "X-AG-Credentials",
          value: "ApiKey mock-gateway-credentials",
        },
      },
    });
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(plan.environment, {});
  });
});
