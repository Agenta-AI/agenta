/**
 * Unit tests for Layer-3 permission enforcement in the runner-side tool relay (S3b).
 *
 *  - `resolvePermission` is the pure ladder: allow/deny are honored as-is; ask/unset degrade to
 *    the headless permission policy (auto -> allow, deny -> deny).
 *  - `startToolRelay` enforces that ladder before executing a relayed tool: a `deny` spec is
 *    refused before execution and an `allow` code spec reaches the sidecar unsupported gate.
 *
 * The relay loop is driven over a real temp dir via `localRelayHost`: write a `<id>.req.json`,
 * poll for the `<id>.res.json` the runner writes back. A `code` spec is used so execution
 * needs no network or callback; the sidecar now returns a deterministic unsupported error
 * instead of spawning a runtime.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-relay-permission.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localRelayHost,
  resolvePermission,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

const codeSpec = (
  name: string,
  permission?: ResolvedToolSpec["permission"],
): ResolvedToolSpec => ({
  name,
  kind: "code",
  runtime: "python",
  code: 'def main(**kw):\n    return {"ran": True, "echo": kw}\n',
  permission,
});

/** Drive one tool call through the relay loop and return the response the runner wrote. */
async function relayOnce(
  spec: ResolvedToolSpec,
  policy: "auto" | "deny",
  args: unknown = { a: 1 },
): Promise<RelayResponse> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-relay-disp-"));
  try {
    const id = "call-1";
    writeFileSync(
      join(dir, `${id}.req.json`),
      JSON.stringify({ toolName: spec.name, toolCallId: id, args }),
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

describe("resolvePermission", () => {
  const cases: Array<[ResolvedToolSpec["permission"], "auto" | "deny", "allow" | "deny"]> = [
    ["allow", "auto", "allow"],
    ["allow", "deny", "allow"],
    ["deny", "auto", "deny"],
    ["deny", "deny", "deny"],
    ["ask", "auto", "allow"],
    ["ask", "deny", "deny"],
    [undefined, "auto", "allow"],
    [undefined, "deny", "deny"],
    // A garbage/unrecognized permission must fall to the policy (never auto-allow).
    ["bogus" as ResolvedToolSpec["permission"], "auto", "allow"],
    ["bogus" as ResolvedToolSpec["permission"], "deny", "deny"],
  ];

  for (const [permission, policy, expected] of cases) {
    it(`permission=${permission ?? "unset"} policy=${policy} -> ${expected}`, () => {
      assert.equal(resolvePermission(permission, policy), expected);
    });
  }
});

describe("startToolRelay permission enforcement", () => {
  it("refuses a deny spec without executing its code", async () => {
    const res = await relayOnce(codeSpec("blocked", "deny"), "auto");
    assert.equal(res.ok, true, "a policy refusal rides as an ok tool result, not an error");
    assert.equal(res.text, "Tool 'blocked' is denied by policy.");
    // The refusal string is the whole result: the snippet's `{"ran": true}` never appears.
    assert.ok(!String(res.text).includes("ran"), "the denied tool's code did not run");
  });

  it("returns unsupported for an allow code spec", async () => {
    const res = await relayOnce(codeSpec("permitted", "allow"), "auto");
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /Code tools are not supported by the sidecar\./);
  });

  it("rejects missing required args before executing a relayed tool", async () => {
    const spec = {
      ...codeSpec("needs_args", "allow"),
      input_schema: {
        type: "object",
        properties: { required_value: { type: "string" } },
        required: ["required_value"],
      },
    } as ResolvedToolSpec;
    const res = await relayOnce(spec, "auto", {});
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /missing required argument\(s\): required_value/);
    assert.ok(
      !String(res.error).includes("Code tools are not supported"),
      "validation failed before sidecar code execution",
    );
  });

  it("refuses an unset spec when the headless policy is deny", async () => {
    const res = await relayOnce(codeSpec("gated", undefined), "deny");
    assert.equal(res.ok, true);
    assert.equal(res.text, "Tool 'gated' requires approval; denied in headless mode.");
  });

  it("parks a browser-fulfilled client tool without writing a relay response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-client-"));
    try {
      const id = "call-client";
      const resPath = join(dir, `${id}.res.json`);
      let parked = false;
      let seenInput: unknown;
      writeFileSync(
        join(dir, `${id}.req.json`),
        JSON.stringify({
          toolName: "request_connection",
          toolCallId: id,
          args: { integration: "slack" },
        }),
      );
      let resolveHandled: () => void = () => {};
      const handled = new Promise<void>((resolve) => {
        resolveHandled = resolve;
      });
      const relay = startToolRelay(
          localRelayHost(),
          dir,
          [{ name: "request_connection", kind: "client" }],
          undefined,
          "auto",
          undefined,
          {
            onClientTool: async (request) => {
              seenInput = request.input;
              return "park";
            },
            onPark: () => {
              parked = true;
              resolveHandled();
            },
          },
      );
      await handled;
      await relay.stop();
      assert.equal(parked, true);
      assert.deepEqual(seenInput, { integration: "slack" });
      assert.equal(existsSync(resPath), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still parks a browser-fulfilled client tool under deny permission policy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-client-"));
    try {
      const id = "call-client";
      let parked = false;
      writeFileSync(
        join(dir, `${id}.req.json`),
        JSON.stringify({
          toolName: "request_connection",
          toolCallId: id,
          args: { integration: "slack" },
        }),
      );
      let resolveHandled: () => void = () => {};
      const handled = new Promise<void>((resolve) => {
        resolveHandled = resolve;
      });
      const relay = startToolRelay(
        localRelayHost(),
        dir,
        [{ name: "request_connection", kind: "client" }],
        undefined,
        "deny",
        undefined,
        {
          onClientTool: async () => "park",
          onPark: () => {
            parked = true;
            resolveHandled();
          },
        },
      );
      await handled;
      await relay.stop();
      assert.equal(parked, true);
      assert.equal(existsSync(join(dir, `${id}.res.json`)), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes stored client-tool output when the browser already fulfilled it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-client-"));
    try {
      const id = "call-client";
      writeFileSync(
        join(dir, `${id}.req.json`),
        JSON.stringify({
          toolName: "request_connection",
          toolCallId: id,
          args: { integration: "slack" },
        }),
      );
      const relay = startToolRelay(
        localRelayHost(),
        dir,
        [{ name: "request_connection", kind: "client" }],
        undefined,
        "auto",
        undefined,
        {
          onClientTool: async () => ({ output: { connected: true } }),
        },
      );
      const resPath = join(dir, `${id}.res.json`);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !existsSync(resPath)) {
        await new Promise((r) => setTimeout(r, 20));
      }
      await relay.stop();
      assert.ok(existsSync(resPath), "the relay wrote a response file");
      const res = JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
      assert.equal(res.ok, true);
      assert.equal(res.text, JSON.stringify({ connected: true }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
