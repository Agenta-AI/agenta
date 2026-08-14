/**
 * The gateway-credentials field, from the consumer side (wave 2's seed, W1 and W2).
 *
 * Asserts the SAME golden the SDK producer asserts in
 * `sdks/python/oss/tests/pytest/unit/agents/test_gateway_credentials.py`, so a leg that drops
 * the field fails here rather than at a run that quietly authenticates as nobody.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import type { AgentRunRequest, ModelConnection } from "../../src/protocol.ts";
import {
  materializeGatewayHeaders,
  materializeModelEnvironment,
} from "../../src/engines/sandbox_agent/run-plan.ts";
import { requestSecretValues } from "../../src/redaction.ts";

const GOLDEN = loadGolden("model_connection.gateway.json") as ModelConnection;

function request(connection: ModelConnection): AgentRunRequest {
  return { modelConnection: connection } as AgentRunRequest;
}

describe("gateway credentials on the wire", () => {
  it("arrives from the shared golden with a header and a value", () => {
    assert.equal(GOLDEN.gatewayCredentials?.header, "X-AG-Credentials");
    assert.equal(
      GOLDEN.gatewayCredentials?.value,
      "ApiKey mock-gateway-credentials",
    );
  });

  it("materializes as a header, and not into the environment", () => {
    assert.deepEqual(materializeGatewayHeaders(request(GOLDEN)), {
      "X-AG-Credentials": "ApiKey mock-gateway-credentials",
    });

    const materialized = materializeModelEnvironment(request(GOLDEN));
    assert.equal(materialized.ok, true);
    assert.deepEqual(materialized.ok && materialized.environment, {});
  });

  it("seeds the run's redaction deny-set", () => {
    assert.ok(
      requestSecretValues(request(GOLDEN)).includes(
        "ApiKey mock-gateway-credentials",
      ),
    );
  });

  it("is absent, not empty, when the model is not reached through a gateway", () => {
    const direct = { ...GOLDEN, gatewayCredentials: undefined };
    assert.deepEqual(materializeGatewayHeaders(request(direct)), {});
  });

  it("refuses an empty header name or value", () => {
    for (const gatewayCredentials of [
      { header: "  ", value: "ApiKey something" },
      { header: "X-AG-Credentials", value: "" },
    ]) {
      const result = materializeModelEnvironment(
        request({ ...GOLDEN, gatewayCredentials }),
      );
      assert.equal(result.ok, false);
    }
  });

  it("refuses a plaintext hop to a remote host and allows one to loopback", () => {
    const remote = materializeModelEnvironment(
      request({
        ...GOLDEN,
        endpoint: { baseUrl: "http://gateway.example.com" },
      }),
    );
    assert.equal(remote.ok, false);

    const loopback = materializeModelEnvironment(
      request({ ...GOLDEN, endpoint: { baseUrl: "http://localhost:8000" } }),
    );
    assert.equal(loopback.ok, true);
  });
});
