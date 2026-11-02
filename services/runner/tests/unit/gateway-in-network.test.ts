/**
 * An in-process harness reaches the model gateway over the in-network api hop
 * (`gateway-in-network.ts`), not through the public load balancer.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-in-network.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { inNetworkApiRoute } from "../../src/apiBase.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { routeGatewayInNetwork } from "../../src/engines/sandbox_agent/gateway-in-network.ts";
import { materializeModelEnvironment } from "../../src/engines/sandbox_agent/run-plan.ts";
import type { AgentRunRequest, ModelConnection } from "../../src/protocol.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";

const PUBLIC = "https://eu.example.com/api";
const INTERNAL = "http://agenta-api:8000";
const ROUTE = "/gateways/llms/builtin/agenta/v1";

function gatewayConnection(baseUrl: string): ModelConnection {
  return {
    provider: "openai",
    deployment: "custom",
    credentialMode: "none",
    credentials: [],
    endpoint: { baseUrl },
    gatewayCredentials: { header: "X-AG-Credentials", value: "Secret run" },
  };
}

function piRun(fields: Partial<AgentRunRequest>): AgentRunRequest {
  return {
    harness: "pi_core",
    modelConnection: gatewayConnection(`${PUBLIC}${ROUTE}`),
    ...fields,
  } as AgentRunRequest;
}

const saved = { ...process.env };
beforeEach(() => {
  process.env = {
    ...saved,
    AGENTA_API_URL: PUBLIC,
    AGENTA_API_INTERNAL_URL: INTERNAL,
    AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona",
    AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona",
    AGENTA_RUNNER_DAYTONA_API_KEY: "k",
  };
  delete process.env.AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED;
  resetRunnerConfigCache();
});
afterEach(() => {
  process.env = { ...saved };
  resetRunnerConfigCache();
});

describe("inNetworkApiRoute", () => {
  it("moves a route on the public base onto the internal base", () => {
    assert.equal(inNetworkApiRoute(`${PUBLIC}${ROUTE}`), `${INTERNAL}${ROUTE}`);
  });

  it("keeps the query string", () => {
    assert.equal(inNetworkApiRoute(`${PUBLIC}${ROUTE}?a=1`), `${INTERNAL}${ROUTE}?a=1`);
  });

  it("leaves another origin alone", () => {
    assert.equal(inNetworkApiRoute(`https://other.example.com/api${ROUTE}`), undefined);
    assert.equal(inNetworkApiRoute(`http://eu.example.com/api${ROUTE}`), undefined);
  });

  it("leaves a path that only shares a prefix with the base alone", () => {
    assert.equal(inNetworkApiRoute(`https://eu.example.com/apix${ROUTE}`), undefined);
  });

  it("does nothing without both bases", () => {
    delete process.env.AGENTA_API_INTERNAL_URL;
    assert.equal(inNetworkApiRoute(`${PUBLIC}${ROUTE}`), undefined);
    process.env.AGENTA_API_INTERNAL_URL = INTERNAL;
    delete process.env.AGENTA_API_URL;
    assert.equal(inNetworkApiRoute(`${PUBLIC}${ROUTE}`), undefined);
  });
});

describe("routeGatewayInNetwork", () => {
  it("moves an in-process Pi run's gateway route", () => {
    const request = piRun({ sandbox: "inprocess" });
    routeGatewayInNetwork(request);
    assert.equal(request.modelConnection?.endpoint?.baseUrl, `${INTERNAL}${ROUTE}`);
  });

  it("leaves a Daytona run on the public route, which is the only one its sandbox can reach", () => {
    const request = piRun({ sandbox: "daytona", harness: "claude_code" });
    routeGatewayInNetwork(request);
    assert.equal(request.modelConnection?.endpoint?.baseUrl, `${PUBLIC}${ROUTE}`);
  });

  it("leaves a direct provider endpoint alone", () => {
    const direct: ModelConnection = {
      ...gatewayConnection(`${PUBLIC}${ROUTE}`),
      gatewayCredentials: undefined,
    };
    const request = piRun({ sandbox: "inprocess", modelConnection: direct });
    routeGatewayInNetwork(request);
    assert.equal(request.modelConnection?.endpoint?.baseUrl, `${PUBLIC}${ROUTE}`);
  });
});

describe("the gateway transport check", () => {
  it("accepts the in-network api hop over plain http", () => {
    const result = materializeModelEnvironment({
      modelConnection: gatewayConnection(`${INTERNAL}${ROUTE}`),
    } as AgentRunRequest);
    assert.equal(result.ok, true);
  });

  it("still refuses any other plain-http host", () => {
    const result = materializeModelEnvironment({
      modelConnection: gatewayConnection(`http://203.0.113.10:8000${ROUTE}`),
    } as AgentRunRequest);
    assert.equal(result.ok, false);
  });
});

describe("the runner's ingress", () => {
  async function postOneShot(body: AgentRunRequest): Promise<AgentRunRequest> {
    process.env.AGENTA_RUNNER_TOKEN = "t";
    let seen: AgentRunRequest | undefined;
    const run: RunAgent = async (request) => {
      seen = request;
      return { ok: true, output: "", events: [] };
    };
    const server = createAgentServer(run);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: JSON.stringify(body),
      });
      await res.text();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    assert.ok(seen, "the run was not called");
    return seen;
  }

  const inSession = {
    sessionId: "conversation-1",
    telemetry: { exporters: { otlp: { headers: { authorization: "ApiKey run" } } } },
  } as Partial<AgentRunRequest>;

  it("hands the engine an in-process Pi run on the in-network route", async () => {
    const seen = await postOneShot(piRun({ ...inSession, sandbox: "daytona" }));
    assert.equal(seen.sandbox, "inprocess");
    assert.equal(seen.modelConnection?.endpoint?.baseUrl, `${INTERNAL}${ROUTE}`);
  });

  it("hands the engine a Codex run on Daytona with the public route", async () => {
    const seen = await postOneShot(piRun({ ...inSession, sandbox: "daytona", harness: "codex" }));
    assert.equal(seen.sandbox, "daytona");
    assert.equal(seen.modelConnection?.endpoint?.baseUrl, `${PUBLIC}${ROUTE}`);
  });
});
