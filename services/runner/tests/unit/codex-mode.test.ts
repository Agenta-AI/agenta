import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  applyCodexMode,
  CODEX_MODES,
  DEFAULT_CODEX_MODE,
  resolveCodexMode,
} from "../../src/engines/sandbox_agent/codex-mode.ts";

describe("resolveCodexMode", () => {
  it("uses the default for absent or invalid values", () => {
    assert.equal(resolveCodexMode(undefined), DEFAULT_CODEX_MODE);
    assert.equal(resolveCodexMode("invalid"), DEFAULT_CODEX_MODE);
  });

  it("keeps every valid Codex mode", () => {
    for (const mode of CODEX_MODES) {
      assert.equal(resolveCodexMode(mode), mode);
    }
  });
});

describe("applyCodexMode", () => {
  it("sets and returns the requested mode", async () => {
    const calls: Array<[string, string]> = [];
    const logs: string[] = [];
    const session = {
      async setConfigOption(key: string, value: string) {
        calls.push([key, value]);
      },
    };

    const applied = await applyCodexMode(session, "agent", (message) =>
      logs.push(message),
    );

    assert.equal(applied, "agent");
    assert.deepEqual(calls, [["mode", "agent"]]);
    assert.deepEqual(logs, ["[codex-mode] applied mode=agent"]);
  });

  it("logs and returns undefined when mode application fails", async () => {
    const logs: string[] = [];
    const session = {
      async setConfigOption() {
        throw new Error("bridge unavailable");
      },
    };

    const applied = await applyCodexMode(
      session,
      "agent-full-access",
      (message) => logs.push(message),
    );

    assert.equal(applied, undefined);
    assert.deepEqual(logs, [
      "[codex-mode] setConfigOption failed mode=agent-full-access: bridge unavailable",
    ]);
  });
});
