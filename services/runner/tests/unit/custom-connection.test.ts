/**
 * Which model connections count as the user's own, so their model spans are not priced from
 * the public price list. `deployment: "custom"` always does. A vault custom-provider record
 * that names a known provider family resolves to `deployment: "direct"`, so for `direct` the
 * route decides: the gateway's `custom` namespace, or a base URL other than the family's
 * registered one.
 *
 * Run: pnpm exec vitest run tests/unit/custom-connection.test.ts
 */
import { describe, expect, it } from "vitest";

import { servedByCustomConnection } from "../../src/tracing/custom-connection.ts";

const GATEWAY = "https://cloud.agenta.ai/api/gateways/llms";
const gatewayCredentials = { value: "ag-credential" } as any;

describe("servedByCustomConnection", () => {
  it("counts a custom deployment", () => {
    expect(
      servedByCustomConnection({ provider: "custom", deployment: "custom" }),
    ).toBe(true);
  });

  it.each([
    ["no connection", undefined],
    [
      "a provider key without an endpoint",
      { provider: "openai", deployment: "direct" },
    ],
    [
      "a provider key at the registered base URL",
      {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.openai.com/v1/" },
      },
    ],
    [
      "a provider key through the gateway",
      {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: `${GATEWAY}/standard/openai/v1` },
        gatewayCredentials,
      },
    ],
    [
      "a bedrock deployment",
      {
        provider: "anthropic",
        deployment: "bedrock",
        endpoint: { region: "us-east-1" },
      },
    ],
  ])("does not count %s", (_label, connection) => {
    expect(servedByCustomConnection(connection as any)).toBe(false);
  });

  it.each([
    [
      "a known-family record with its own base URL",
      {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://llm.example.com/v1" },
      },
    ],
    [
      "a known-family record through the gateway",
      {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: `${GATEWAY}/custom/my-openai/v1` },
        gatewayCredentials,
      },
    ],
    [
      "an anthropic-family record through the gateway",
      {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: `${GATEWAY}/custom/my-anthropic` },
        gatewayCredentials,
      },
    ],
    [
      "a record at the provider host with a different path",
      {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.openai.com/v2" },
      },
    ],
    [
      "a family with no registered base URL",
      {
        provider: "deepseek",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.deepseek.com/v1" },
      },
    ],
  ])("counts %s", (_label, connection) => {
    expect(servedByCustomConnection(connection as any)).toBe(true);
  });
});
