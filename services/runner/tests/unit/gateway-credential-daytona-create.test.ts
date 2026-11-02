/**
 * The Daytona create request carries the gateway credential's placeholder, never the credential.
 *
 * `buildSandboxProvider` closes over the create request, so this case replaces the Daytona
 * lifecycle wrapper and the Secret client with fakes and reads the create options the runner
 * actually hands Daytona.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-credential-daytona-create.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

const created: Array<Record<string, any>> = [];

vi.mock(
  "../../src/engines/sandbox_agent/daytona-provider.ts",
  async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    let count = 0;
    return {
      ...original,
      applyDaytonaSdkEnv: () => {},
      buildDaytonaClient: () => ({
        secret: {
          async create(input: { name: string; hosts: string[] }) {
            count += 1;
            return {
              id: `secret-${count}`,
              name: input.name,
              placeholder: `dtn_secret_${count}`,
              hosts: input.hosts,
            };
          },
          async update() {
            throw new Error("unexpected update");
          },
          async delete() {},
        },
      }),
      daytonaWithLifecycle: (options: Record<string, any>) => ({
        name: "daytona",
        async create() {
          created.push(options.create);
          return "sandbox-1";
        },
        async destroy() {},
      }),
    };
  },
);

const { buildSandboxProvider } =
  await import("../../src/engines/sandbox_agent/provider.ts");
const { buildDaytonaSecretPlan } =
  await import("../../src/engines/sandbox_agent/daytona-secret-plan.ts");
const { GATEWAY_SECRET_ATTACHMENT } =
  await import("../../src/engines/sandbox_agent/daytona-secrets.ts");
const { parseRunnerConfig } = await import("../../src/config/runner-config.ts");

/** Not a key shape: a real-looking one trips the repository's secret scanner. */
const CREDENTIAL = "Secret the-gateway-credential-under-test";

describe("the Daytona create request on a gateway run", () => {
  it("attaches the Secret and writes only its placeholder into the environment", async () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        credentialMode: "none",
        credentials: [],
        endpoint: {
          baseUrl:
            "https://gateway.example/api/gateways/llms/builtin/openai/v1",
        },
        gatewayCredentials: { header: "X-AG-Credentials", value: CREDENTIAL },
      },
    });
    const config = parseRunnerConfig({
      AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona",
      AGENTA_RUNNER_DAYTONA_API_KEY: "test-key",
    });
    const provider = buildSandboxProvider(
      "daytona",
      {},
      undefined,
      {
        AGENTA_GATEWAY_CREDENTIALS_VALUE: CREDENTIAL,
        ANTHROPIC_CUSTOM_HEADERS: `X-AG-Credentials: ${CREDENTIAL}`,
      },
      {},
      undefined,
      plan,
      { config },
    ) as { create: () => Promise<string> };

    await provider.create();

    assert.equal(created.length, 1);
    const create = created[0];
    assert.deepEqual(Object.keys(create.secrets), [GATEWAY_SECRET_ATTACHMENT]);
    assert.equal(
      create.envVars.AGENTA_GATEWAY_CREDENTIALS_VALUE,
      "dtn_secret_1",
    );
    assert.equal(
      create.envVars.ANTHROPIC_CUSTOM_HEADERS,
      "X-AG-Credentials: dtn_secret_1",
    );
    assert.ok(!JSON.stringify(create).includes(CREDENTIAL));
  });
});
