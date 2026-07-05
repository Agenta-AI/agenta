/**
 * Unit tests for the Pi builtin permission relay helper.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-dispatch-permission.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-permission-relay-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${path}`);
}

describe("relayPermissionCheck", () => {
  it("round-trips a permission request and parses the response", async () => {
    const { relayPermissionCheck } = await import("../../src/tools/dispatch.ts");
    const {
      RELAY_PERMISSION_PROTOCOL,
      RELAY_REQ_SUFFIX,
      RELAY_RES_SUFFIX,
      sanitizeRelayId,
    } = await import("../../src/tools/relay.ts");
    const dir = tempDir();
    const toolCallId = "call/bash:1";
    const id = sanitizeRelayId(toolCallId);
    const reqPath = join(dir, `${id}${RELAY_REQ_SUFFIX}`);
    const resPath = join(dir, `${id}${RELAY_RES_SUFFIX}`);

    const pending = relayPermissionCheck(dir, "bash", toolCallId, {
      command: "npm test",
    });
    await waitForFile(reqPath);

    assert.deepEqual(JSON.parse(readFileSync(reqPath, "utf-8")), {
      kind: "permission",
      protocol: RELAY_PERMISSION_PROTOCOL,
      toolName: "bash",
      toolCallId,
      args: { command: "npm test" },
    });

    writeFileSync(
      resPath,
      JSON.stringify({ kind: "permission", ok: true, verdict: "allow" }),
      "utf-8",
    );

    assert.deepEqual(await pending, {
      kind: "permission",
      ok: true,
      verdict: "allow",
    });
  });

  it("fails closed on an unparseable response", async () => {
    const { relayPermissionCheck } = await import("../../src/tools/dispatch.ts");
    const { RELAY_RES_SUFFIX, sanitizeRelayId } = await import(
      "../../src/tools/relay.ts"
    );
    const dir = tempDir();
    const toolCallId = "call-unparseable";
    writeFileSync(
      join(dir, `${sanitizeRelayId(toolCallId)}${RELAY_RES_SUFFIX}`),
      "not json",
      "utf-8",
    );

    const response = await relayPermissionCheck(dir, "write", toolCallId, {
      file_path: "x",
    });

    assert.equal(response.kind, "permission");
    assert.equal(response.ok, false);
    assert.equal(response.verdict, "deny");
    assert.match(response.reason ?? "", /unparseable/);
  });

  it("fails closed when the runner responds ok:false", async () => {
    const { relayPermissionCheck } = await import("../../src/tools/dispatch.ts");
    const { RELAY_RES_SUFFIX, sanitizeRelayId } = await import(
      "../../src/tools/relay.ts"
    );
    const dir = tempDir();
    const toolCallId = "call-failed";
    writeFileSync(
      join(dir, `${sanitizeRelayId(toolCallId)}${RELAY_RES_SUFFIX}`),
      JSON.stringify({
        kind: "permission",
        ok: false,
        verdict: "allow",
        reason: "runner failed\nwhile deciding",
      }),
      "utf-8",
    );

    const response = await relayPermissionCheck(dir, "edit", toolCallId, {});

    assert.deepEqual(response, {
      kind: "permission",
      ok: false,
      verdict: "deny",
      reason: "runner failed while deciding",
    });
  });

  it("fails closed on timeout", async () => {
    vi.resetModules();
    vi.stubEnv("AGENTA_AGENT_TOOLS_RELAY_TIMEOUT", "10");
    vi.stubEnv("AGENTA_AGENT_TOOLS_RELAY_POLLING", "1");
    const { relayPermissionCheck } = await import("../../src/tools/dispatch.ts");
    const dir = tempDir();

    const response = await relayPermissionCheck(dir, "read", "call-timeout", {
      file_path: "README.md",
    });

    assert.equal(response.kind, "permission");
    assert.equal(response.ok, false);
    assert.equal(response.verdict, "deny");
    assert.match(response.reason ?? "", /timed out/);
  });
});
