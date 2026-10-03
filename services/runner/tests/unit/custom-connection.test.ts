/**
 * Which model connections count as the user's own, so their model spans are not priced from a
 * public price list. The SDK's explicit `customConnection` decides; without it (older SDKs) only
 * `deployment: "custom"` counts.
 *
 * Run: pnpm exec vitest run tests/unit/custom-connection.test.ts
 */
import { describe, expect, it } from "vitest";

import { servedByCustomConnection } from "../../src/tracing/custom-connection.ts";

describe("servedByCustomConnection", () => {
  it.each([
    [
      "the SDK says custom",
      { deployment: "direct", customConnection: true },
      true,
    ],
    [
      "the SDK says not custom",
      { deployment: "custom", customConnection: false },
      false,
    ],
    ["an older SDK's custom deployment", { deployment: "custom" }, true],
    ["an older SDK's direct route", { deployment: "direct" }, false],
    ["no connection", undefined, false],
  ])("%s", (_case, connection, expected) => {
    expect(servedByCustomConnection(connection)).toBe(expected);
  });
});
