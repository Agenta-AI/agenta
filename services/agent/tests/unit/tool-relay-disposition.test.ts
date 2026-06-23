/**
 * Unit tests for Layer-3 disposition enforcement in the runner-side tool relay (S3b).
 *
 *  - `resolveDisposition` is the pure ladder: allow/deny are honored as-is; ask/unset degrade to
 *    the headless permission policy (auto -> allow, deny -> deny).
 *  - `startToolRelay` enforces that ladder before executing a relayed tool: a `deny` spec is
 *    refused (its `code` never runs) and an `allow` spec executes normally.
 *
 * The relay loop is driven over a real temp dir via `localRelayHost`: write a `<id>.req.json`,
 * poll for the `<id>.res.json` the runner writes back. A `code` spec is used so execution needs
 * no network or callback (it shells out to python3, available locally).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-relay-disposition.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localRelayHost,
  resolveDisposition,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

const codeSpec = (
  name: string,
  disposition?: ResolvedToolSpec["disposition"],
): ResolvedToolSpec => ({
  name,
  kind: "code",
  runtime: "python",
  // Marks that the snippet actually ran (a denied tool must never reach this).
  code: 'def main(**kw):\n    return {"ran": True, "echo": kw}\n',
  disposition,
});

/** Drive one tool call through the relay loop and return the response the runner wrote. */
async function relayOnce(
  spec: ResolvedToolSpec,
  policy: "auto" | "deny",
): Promise<RelayResponse> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-relay-disp-"));
  try {
    const id = "call-1";
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({ toolName: spec.name, toolCallId: id, args: { a: 1 } }),
    );
    const relay = startToolRelay(localRelayHost(), dir, [spec], undefined, policy);
    const resPath = join(dir, `${id}.res.json`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(resPath)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await relay.stop();
    assert.ok(existsSync(resPath), "the relay wrote a response file");
    return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("resolveDisposition", () => {
  const cases: Array<[ResolvedToolSpec["disposition"], "auto" | "deny", "allow" | "deny"]> = [
    ["allow", "auto", "allow"],
    ["allow", "deny", "allow"],
    ["deny", "auto", "deny"],
    ["deny", "deny", "deny"],
    ["ask", "auto", "allow"],
    ["ask", "deny", "deny"],
    [undefined, "auto", "allow"],
    [undefined, "deny", "deny"],
    // A garbage/unrecognized disposition must fall to the policy (never auto-allow).
    ["bogus" as ResolvedToolSpec["disposition"], "auto", "allow"],
    ["bogus" as ResolvedToolSpec["disposition"], "deny", "deny"],
  ];

  for (const [disposition, policy, expected] of cases) {
    it(`disposition=${disposition ?? "unset"} policy=${policy} -> ${expected}`, () => {
      assert.equal(resolveDisposition(disposition, policy), expected);
    });
  }
});

describe("startToolRelay disposition enforcement", () => {
  it("refuses a deny spec without executing its code", async () => {
    const res = await relayOnce(codeSpec("blocked", "deny"), "auto");
    assert.equal(res.ok, true, "a policy refusal rides as an ok tool result, not an error");
    assert.equal(res.text, "Tool 'blocked' is denied by policy.");
    // The refusal string is the whole result: the snippet's `{"ran": true}` never appears.
    assert.ok(!String(res.text).includes("ran"), "the denied tool's code did not run");
  });

  it("runs an allow spec", async () => {
    const res = await relayOnce(codeSpec("permitted", "allow"), "auto");
    assert.equal(res.ok, true);
    assert.deepEqual(JSON.parse(res.text ?? "{}"), { ran: true, echo: { a: 1 } });
  });

  it("refuses an unset spec when the headless policy is deny", async () => {
    const res = await relayOnce(codeSpec("gated", undefined), "deny");
    assert.equal(res.ok, true);
    assert.equal(res.text, "Tool 'gated' requires approval; denied in headless mode.");
  });
});
