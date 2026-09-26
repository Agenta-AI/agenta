/**
 * Which model connections count as the user's own, so their model spans are not priced from
 * the public price list. The SDK's explicit `customConnection` decides when present. Without it
 * (older SDKs) the route decides: `deployment: "custom"`, the gateway's `custom` namespace for
 * any deployment, or a `direct` base URL other than the family's registered one.
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
    [
      "a bedrock provider key through the gateway",
      {
        provider: "anthropic",
        deployment: "bedrock",
        endpoint: { baseUrl: `${GATEWAY}/standard/anthropic/v1` },
        gatewayCredentials,
      },
    ],
    [
      "a family with no registered base URL (fallback)",
      {
        provider: "deepseek",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.deepseek.com/v1" },
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
      "a bedrock-deployment record through the gateway",
      {
        provider: "anthropic",
        deployment: "bedrock",
        endpoint: { baseUrl: `${GATEWAY}/custom/my-bedrock/v1` },
        gatewayCredentials,
      },
    ],
  ])("counts %s", (_label, connection) => {
    expect(servedByCustomConnection(connection as any)).toBe(true);
  });

  describe("explicit customConnection from the SDK", () => {
    it("counts a custom record at the family's registered base URL", () => {
      expect(
        servedByCustomConnection({
          provider: "openai",
          deployment: "direct",
          endpoint: { baseUrl: "https://api.openai.com/v1" },
          customConnection: true,
        } as any),
      ).toBe(true);
    });

    it("does not count a provider key whose URL the table does not know", () => {
      expect(
        servedByCustomConnection({
          provider: "openai",
          deployment: "direct",
          endpoint: { baseUrl: "https://llm.example.com/v1" },
          customConnection: false,
        } as any),
      ).toBe(false);
    });

    it("overrides the gateway namespace and the deployment", () => {
      expect(
        servedByCustomConnection({
          provider: "custom",
          deployment: "custom",
          customConnection: false,
        } as any),
      ).toBe(false);
      expect(
        servedByCustomConnection({
          provider: "openai",
          deployment: "direct",
          endpoint: { baseUrl: `${GATEWAY}/standard/openai/v1` },
          gatewayCredentials,
          customConnection: true,
        } as any),
      ).toBe(true);
    });

    it("falls back to the route when the field is not a boolean", () => {
      expect(
        servedByCustomConnection({
          provider: "openai",
          deployment: "direct",
          endpoint: { baseUrl: "https://llm.example.com/v1" },
          customConnection: "yes",
        } as any),
      ).toBe(true);
    });
  });
});
