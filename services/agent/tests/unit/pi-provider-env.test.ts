/**
 * Unit tests for the in-process Pi clear-then-apply provider env (Security rule 5).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/pi-provider-env.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { withRequestProviderEnv } from "../../src/engines/pi.ts";

const touched = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
const previous = new Map<string, string | undefined>();
for (const key of touched) previous.set(key, process.env[key]);

afterEach(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("withRequestProviderEnv", () => {
  it("clears a stale inherited key before applying the resolved env on a managed run", async () => {
    // A stale key for a DIFFERENT provider is in the process env (the sidecar's own).
    process.env.ANTHROPIC_API_KEY = "stale-anthropic";
    delete process.env.OPENAI_API_KEY;

    let seenAnthropic: string | undefined = "unset";
    let seenOpenai: string | undefined = "unset";
    await withRequestProviderEnv(
      { OPENAI_API_KEY: "resolved-openai" },
      async () => {
        // During the run: the stale Anthropic key is gone (no leak) and only the resolved
        // OpenAI key is present.
        seenAnthropic = process.env.ANTHROPIC_API_KEY;
        seenOpenai = process.env.OPENAI_API_KEY;
      },
      "env", // managed run
    );

    assert.equal(seenAnthropic, undefined); // the stale key did NOT leak into the run
    assert.equal(seenOpenai, "resolved-openai");
    // Restored exactly on finally: the stale Anthropic key is back, the applied OpenAI key gone.
    assert.equal(process.env.ANTHROPIC_API_KEY, "stale-anthropic");
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  });

  it("does NOT clear inherited keys on a runtime_provided run (the harness uses its own env)", async () => {
    process.env.ANTHROPIC_API_KEY = "own-anthropic";

    let seenAnthropic: string | undefined = "unset";
    await withRequestProviderEnv(
      {},
      async () => {
        seenAnthropic = process.env.ANTHROPIC_API_KEY;
      },
      "runtime_provided",
    );

    // The harness's own inherited key stays available during the run.
    assert.equal(seenAnthropic, "own-anthropic");
    assert.equal(process.env.ANTHROPIC_API_KEY, "own-anthropic");
  });

  it("does NOT clear when no credentialMode is given (un-migrated caller, back-compat)", async () => {
    process.env.ANTHROPIC_API_KEY = "own-anthropic";

    let seenAnthropic: string | undefined = "unset";
    await withRequestProviderEnv({ OPENAI_API_KEY: "k" }, async () => {
      seenAnthropic = process.env.ANTHROPIC_API_KEY;
    });

    assert.equal(seenAnthropic, "own-anthropic");
  });
});
