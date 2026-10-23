/**
 * The gateway credential rides a Daytona Secret on a Daytona run.
 *
 * The runner builds the harness connection settings before any Secret exists, so those settings
 * hold the raw gateway credential: the gateway variable itself, the Pi model endpoint override,
 * Claude Code's custom headers, and the Pi extension's MCP config. On Daytona the credential is
 * planned as a Secret restricted to the gateway host, and every one of those copies is swapped for
 * the Secret's placeholder before the sandbox is created. These cases pin each step and then the
 * property itself: no variable the sandbox receives still holds the credential.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-credential-daytona-secret.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { daytonaEnvVars } from "../../src/engines/sandbox_agent/daytona.ts";
import {
  buildDaytonaSecretPlan,
  credentialSlotFor,
  type DaytonaSecretPlan,
} from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import {
  allocateDaytonaSecrets,
  DAYTONA_SECRETS_PERMISSION_MESSAGE,
  GATEWAY_SECRET_ATTACHMENT,
  gatewayCredentialPlaceholders,
  swapGatewayCredentials,
  type DaytonaSecretApi,
  type GatewayCredentialPlaceholders,
} from "../../src/engines/sandbox_agent/daytona-secrets.ts";
import {
  daytonaWithProcessLocalSecrets,
  type DaytonaProviderLike,
} from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
import type { RunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import { GATEWAY_CREDENTIALS_VALUE_ENV } from "../../src/engines/sandbox_agent/run-plan.ts";
import { buildRuntimeEnvironment } from "../../src/environment/runtime-lifecycle.ts";
import { slotKey } from "../../src/providers/credential-delivery-port.ts";
import { PI_GATEWAY_MCP_SERVERS_ENV } from "../../src/extensions/pi-mcp.ts";
import type {
  AgentRunRequest,
  McpServerConfig,
  ModelConnection,
} from "../../src/protocol.ts";

/** Not a key shape: a real-looking one trips the repository's secret scanner. */
const CREDENTIAL = "Secret the-gateway-credential-under-test";
const MCP_CREDENTIAL = "Secret the-mcp-gateway-credential-under-test";
const GATEWAY_BASE =
  "https://gateway.example/api/gateways/llms/builtin/openai/v1";

const gatewayConnection = (baseUrl = GATEWAY_BASE): ModelConnection =>
  ({
    provider: "openai",
    deployment: "direct",
    credentialMode: "none",
    credentials: [],
    endpoint: { baseUrl },
    gatewayCredentials: { header: "X-AG-Credentials", value: CREDENTIAL },
  }) as ModelConnection;

const gatewayMcpServer: McpServerConfig = {
  name: "github",
  connection: {
    type: "http",
    url: "https://gateway.example/api/gateways/mcps/custom/github",
    credentials: [
      {
        binding: { kind: "header", name: "X-AG-Credentials" },
        value: MCP_CREDENTIAL,
        usage: "opaque_http",
      },
    ],
  },
  policy: { tools: { mode: "all" } },
} as McpServerConfig;

/** A fake Secret store that numbers its placeholders in creation order. */
function secretApi(
  options: { refuse?: boolean; created?: string[] } = {},
): DaytonaSecretApi {
  let count = 0;
  return {
    async create(input) {
      if (options.refuse) {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }
      count += 1;
      options.created?.push(input.value);
      return {
        id: `secret-${count}`,
        name: input.name,
        placeholder: `dtn_secret_${count}`,
        hosts: input.hosts,
      };
    },
    async update(id) {
      throw new Error(`unexpected update of ${id}`);
    },
    async delete() {},
  };
}

describe("planning the gateway credential", () => {
  it("plans it as a Secret restricted to the gateway host", () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: gatewayConnection(),
    });

    assert.deepEqual(plan.environment, {});
    assert.deepEqual(plan.candidates, [
      {
        ordinal: 0,
        consumer: { kind: "gateway" },
        binding: { kind: "header", name: "X-AG-Credentials" },
        allowedHost: "gateway.example",
        value: CREDENTIAL,
      },
    ]);
  });

  it("leaves it a plain value, as before, when the gateway endpoint cannot carry a host restriction", () => {
    // Plain HTTP and IP literals cannot be restricted to one DNS host. These deployments ran
    // with a plain gateway credential before it was hidden, and must keep running.
    for (const baseUrl of [
      "http://gateway.example/api/gateways/llms/builtin/openai/v1",
      "https://203.0.113.7/api/gateways/llms/builtin/openai/v1",
    ]) {
      const plan = buildDaytonaSecretPlan({
        modelConnection: gatewayConnection(baseUrl),
      });
      assert.deepEqual(plan.candidates, [], baseUrl);
    }
  });

  it("gives the gateway its own slot, apart from a provider key and an MCP server", () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: gatewayConnection(),
      mcpServers: [gatewayMcpServer],
    });
    const keys = plan.candidates.map((candidate) =>
      slotKey(credentialSlotFor(candidate)),
    );

    assert.equal(new Set(keys).size, 2);
    assert.deepEqual(
      plan.candidates.map((candidate) => credentialSlotFor(candidate).consumer),
      [{ kind: "gateway" }, { kind: "mcp", server: "github" }],
    );
  });
});

describe("allocating and placing the gateway credential", () => {
  it("attaches the Secret under the runner-owned gateway variable", async () => {
    const plan = buildDaytonaSecretPlan({
      modelConnection: gatewayConnection(),
    });
    const created: string[] = [];
    const allocation = await allocateDaytonaSecrets(
      plan,
      secretApi({ created }),
      () => "agenta_test_0",
    );

    assert.deepEqual(created, [CREDENTIAL]);
    assert.deepEqual(allocation.attachments, {
      [GATEWAY_SECRET_ATTACHMENT]: "agenta_test_0",
    });
    assert.deepEqual(gatewayCredentialPlaceholders(plan, allocation), {
      gateway: { value: CREDENTIAL, placeholder: "dtn_secret_1" },
      mcpHeaders: {},
    });
  });

  it("replaces plain and JSON-escaped copies of the gateway credential, and nothing else", () => {
    const value = 'Secret with "quotes"';
    const swapped = swapGatewayCredentials(
      {
        WHOLE: value,
        HEADERS: `X-AG-Credentials: ${value}`,
        JSON: JSON.stringify({ headers: { "X-AG-Credentials": value } }),
        OTHER: "untouched",
      },
      { gateway: { value, placeholder: "dtn_secret_1" }, mcpHeaders: {} },
    );

    assert.deepEqual(swapped, {
      WHOLE: "dtn_secret_1",
      HEADERS: "X-AG-Credentials: dtn_secret_1",
      JSON: JSON.stringify({ headers: { "X-AG-Credentials": "dtn_secret_1" } }),
      OTHER: "untouched",
    });
  });

  it("rewrites the Pi MCP config by field, so a short header value is never replaced elsewhere", () => {
    const swapped = swapGatewayCredentials(
      {
        [PI_GATEWAY_MCP_SERVERS_ENV]: JSON.stringify({
          version: 1,
          servers: [
            {
              name: "docs",
              url: "https://gateway.eu.example/api/gateways/mcps/custom/docs",
              headers: { "X-Region": "eu" },
            },
          ],
        }),
        AGENTA_API_URL: "https://gateway.eu.example/api",
      },
      { mcpHeaders: { docs: { "X-Region": "dtn_secret_7" } } },
    );

    assert.equal(swapped.AGENTA_API_URL, "https://gateway.eu.example/api");
    assert.deepEqual(
      JSON.parse(swapped[PI_GATEWAY_MCP_SERVERS_ENV]).servers[0],
      {
        name: "docs",
        url: "https://gateway.eu.example/api/gateways/mcps/custom/docs",
        headers: { "X-Region": "dtn_secret_7" },
      },
    );
  });
});

/** A Daytona gateway run for one harness, with only the fields the builder reads. */
const daytonaPlan = (acpAgent: "pi" | "claude" | "codex"): RunPlan =>
  ({
    acpAgent,
    isPi: acpAgent === "pi",
    isDaytona: true,
    sandboxId: "daytona",
    workspace: {
      cwd: "/workspace",
      relayDir: "/tmp/relay",
      telemetryDir: "/tmp/telemetry",
      toolMcpDir: "/tmp/toolmcp",
      skillDirs: [],
      skillsDropped: [],
      skillsCleanup: () => {},
      sourcePiAgentDir: "/tmp/pi",
    },
    tools: { builtinGatingActive: false, toolSpecs: undefined },
    credentials: {
      modelEnvironment: {},
      sandboxEnvironment: {},
      harnessApiKeyVar: "OPENAI_API_KEY",
      hasApiKey: false,
      credentialMode: "none",
    },
  }) as unknown as RunPlan;

describe("what the Daytona sandbox receives on a gateway run", () => {
  for (const acpAgent of ["pi", "claude", "codex"] as const) {
    it(`holds no copy of the gateway credential for ${acpAgent}`, async () => {
      const request = {
        harness: acpAgent,
        modelConnection: gatewayConnection(),
        // Only Pi carries its MCP config in the environment; the other harnesses get it in the
        // session config, which `materializeMcpServers` already rewrites.
        ...(acpAgent === "pi" ? { mcpServers: [gatewayMcpServer] } : {}),
      } as unknown as AgentRunRequest;
      const plan = daytonaPlan(acpAgent);
      const runtime = buildRuntimeEnvironment({
        plan,
        request,
        piSkillSnapshot: undefined,
        log: (() => {}) as never,
        deps: { buildDaemonEnv: (() => ({})) as never },
      });
      const raw = daytonaEnvVars(
        runtime.piExtEnv,
        plan.credentials.modelEnvironment,
      );
      // The premise: before the swap, the settings hold the raw credential.
      assert.ok(Object.values(raw).some((value) => value.includes(CREDENTIAL)));

      const secretPlan = buildDaytonaSecretPlan({
        modelConnection: request.modelConnection,
        mcpServers: request.mcpServers,
      });
      const allocation = await allocateDaytonaSecrets(secretPlan, secretApi());
      const sandboxEnv = swapGatewayCredentials(
        raw,
        gatewayCredentialPlaceholders(secretPlan, allocation),
      );

      for (const [name, value] of Object.entries(sandboxEnv)) {
        assert.ok(!value.includes(CREDENTIAL), `${name} holds the credential`);
        assert.ok(
          !value.includes(MCP_CREDENTIAL),
          `${name} holds the MCP credential`,
        );
      }
      // The harness still reads a value from where it always did: the placeholder.
      assert.equal(sandboxEnv[GATEWAY_CREDENTIALS_VALUE_ENV], "dtn_secret_1");
    });
  }
});

describe("creating the sandbox", () => {
  function provider(log: Array<Record<string, unknown>>) {
    return (
      attachments: Record<string, string>,
      gatewayPlaceholders?: GatewayCredentialPlaceholders,
    ): DaytonaProviderLike => {
      log.push({ attachments, gatewayPlaceholders });
      return {
        name: "daytona",
        async create() {
          return "sandbox-1";
        },
        async destroy() {
          log.push({ destroyed: true });
        },
        async reconnect() {},
      };
    };
  }

  it("hands the provider the placeholders it must write into the environment", async () => {
    const built: Array<Record<string, unknown>> = [];
    const wrapped = daytonaWithProcessLocalSecrets(
      provider(built),
      buildDaytonaSecretPlan({ modelConnection: gatewayConnection() }),
      secretApi(),
      {
        registry: new Map(),
        createFingerprint: "fingerprint",
        cleanupDelayMilliseconds: 1_000,
      },
    );

    await wrapped.create();

    assert.equal(built.length, 1);
    assert.deepEqual(Object.keys(built[0].attachments as object), [
      GATEWAY_SECRET_ATTACHMENT,
    ]);
    assert.deepEqual(built[0].gatewayPlaceholders, {
      gateway: { value: CREDENTIAL, placeholder: "dtn_secret_1" },
      mcpHeaders: {},
    });
  });

  it("still runs a built-in model run when the API key may not manage Secrets", async () => {
    // Before the gateway credential was hidden, such a run made no Secret call at all. It keeps
    // running, with the credential as a plain value, rather than failing on a permission it
    // never needed.
    const built: Array<Record<string, unknown>> = [];
    const messages: string[] = [];
    const wrapped = daytonaWithProcessLocalSecrets(
      provider(built),
      buildDaytonaSecretPlan({ modelConnection: gatewayConnection() }),
      secretApi({ refuse: true }),
      {
        registry: new Map(),
        createFingerprint: "fingerprint",
        cleanupDelayMilliseconds: 1_000,
        log: (message) => messages.push(message),
      },
    );

    assert.equal(await wrapped.create(), "sandbox-1");
    assert.deepEqual(built, [
      { attachments: {}, gatewayPlaceholders: { mcpHeaders: {} } },
    ]);
    assert.ok(
      messages.some((message) => message.includes("may not manage Secrets")),
    );
    // No Secret holds the credential, so there is nothing to rotate in place.
    assert.equal(wrapped.credentialDeliveryPort(), undefined);

    // The same plan reconnects to the same sandbox instead of rebuilding it.
    await wrapped.reconnect!("sandbox-1");
    assert.ok(
      !(built as Array<Record<string, unknown>>).some(
        (entry) => entry.destroyed,
      ),
    );
  });

  it("does not fall back on a refusal that is not Daytona's 403", async () => {
    const api = secretApi();
    api.create = async () => {
      throw new Error(
        "Request failed: missing permission to read the snapshot",
      );
    };
    const wrapped = daytonaWithProcessLocalSecrets(
      provider([]),
      buildDaytonaSecretPlan({ modelConnection: gatewayConnection() }),
      api,
      {
        registry: new Map(),
        createFingerprint: "fingerprint",
        cleanupDelayMilliseconds: 1_000,
      },
    );

    await assert.rejects(wrapped.create(), {
      message: DAYTONA_SECRETS_PERMISSION_MESSAGE,
    });
  });

  it("still fails a run that also hides an MCP credential, as it always did", async () => {
    const wrapped = daytonaWithProcessLocalSecrets(
      provider([]),
      buildDaytonaSecretPlan({
        modelConnection: gatewayConnection(),
        mcpServers: [gatewayMcpServer],
      }),
      secretApi({ refuse: true }),
      {
        registry: new Map(),
        createFingerprint: "fingerprint",
        cleanupDelayMilliseconds: 1_000,
      },
    );

    await assert.rejects(wrapped.create(), {
      message: DAYTONA_SECRETS_PERMISSION_MESSAGE,
    });
  });
});
