/**
 * An api base env var set to an empty or whitespace-only string counts as unset. Compose and Helm
 * pass an unset variable through as "", and `??` kept that empty string as the base, which broke
 * every runner-to-api call ("Failed to parse URL from /sessions/streams/heartbeat").
 *
 * Run: pnpm exec vitest run tests/unit/apibase-empty-env.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  apiBase,
  inNetworkApiRoute,
  isInNetworkApiEndpoint,
  trustedApiBase,
} from "../../src/apiBase.ts";
import {
  configuredIngestBases,
  publicApiBaseConfigured,
} from "../../src/tracing/otel.ts";

const INTERNAL_ENV = "AGENTA_API_INTERNAL_URL";
const PUBLIC_ENV = "AGENTA_API_URL";
const previousInternal = process.env[INTERNAL_ENV];
const previousPublic = process.env[PUBLIC_ENV];

function setEnv(internal: string | undefined, publicUrl: string | undefined) {
  if (internal === undefined) delete process.env[INTERNAL_ENV];
  else process.env[INTERNAL_ENV] = internal;
  if (publicUrl === undefined) delete process.env[PUBLIC_ENV];
  else process.env[PUBLIC_ENV] = publicUrl;
}

afterEach(() => setEnv(previousInternal, previousPublic));

const BLANKS: Array<[string, string | undefined]> = [
  ["unset", undefined],
  ["empty", ""],
  ["whitespace", "   \t "],
];

describe("api base env vars: blank means unset", () => {
  for (const [label, blank] of BLANKS) {
    it(`falls back to the default when both are ${label}`, () => {
      setEnv(blank, blank);
      assert.equal(apiBase(), "http://api:8000");
      assert.equal(trustedApiBase(), "http://api:8000");
    });

    it(`uses AGENTA_API_URL when the internal url is ${label}`, () => {
      setEnv(blank, "http://host/api/");
      assert.equal(apiBase(), "http://host/api");
      assert.equal(trustedApiBase(), "http://host/api");
    });

    it(`uses the internal url when the public url is ${label}`, () => {
      setEnv("http://api:8000", blank);
      assert.equal(apiBase(), "http://api:8000");
    });

    it(`does not treat a ${label} internal url as an in-network endpoint`, () => {
      setEnv(blank, "http://host/api");
      assert.equal(isInNetworkApiEndpoint("http://host/api/x"), false);
      assert.equal(inNetworkApiRoute("http://host/api/x"), undefined);
    });

    it(`does not count a ${label} public url as configured`, () => {
      setEnv(blank, blank);
      assert.equal(publicApiBaseConfigured(), false);
      assert.deepEqual(configuredIngestBases(), ["https://cloud.agenta.ai/api"]);
    });
  }

  it("trims surrounding whitespace from a real value", () => {
    setEnv("  http://api:8000/  ", undefined);
    assert.equal(apiBase(), "http://api:8000");
  });
});
