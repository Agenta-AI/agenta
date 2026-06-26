/**
 * Unit tests for the in-sandbox stdio MCP relay shim asset upload (F-042).
 *
 * The upload is FAIL-LOUD on the path that requires it: a missing bundle or a failed upload throws
 * `RELAY_SHIM_UNAVAILABLE_MESSAGE` (the engine turns it into `{ok:false,error}`), rather than
 * silently dropping the run's tools — exactly the silent drop F-042 was.
 *
 * Run: pnpm exec vitest run tests/unit/relay-shim.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RELAY_SHIM_UNAVAILABLE_MESSAGE,
  uploadRelayShimToSandbox,
} from "../../src/engines/sandbox_agent/relay-shim.ts";

const dirs: string[] = [];
const prevBundle = process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (prevBundle === undefined)
    delete process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE;
  else process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = prevBundle;
});

describe("uploadRelayShimToSandbox", () => {
  it("uploads the bundle and returns the in-sandbox path", async () => {
    const bundleDir = mkdtempSync(join(tmpdir(), "agenta-relay-shim-bundle-"));
    dirs.push(bundleDir);
    const bundlePath = join(bundleDir, "relay-mcp-stdio.js");
    writeFileSync(bundlePath, "// shim bundle", "utf-8");
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = bundlePath;

    const calls: Array<{ op: string; path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    const dest = await uploadRelayShimToSandbox(
      sandbox,
      "/home/sandbox/agenta-x/.agenta-tools",
    );
    assert.equal(
      dest,
      "/home/sandbox/agenta-x/.agenta-tools/relay-mcp-stdio.js",
    );
    assert.deepEqual(calls, [
      { op: "mkdir", path: "/home/sandbox/agenta-x/.agenta-tools" },
      {
        op: "write",
        path: "/home/sandbox/agenta-x/.agenta-tools/relay-mcp-stdio.js",
        body: "// shim bundle",
      },
    ]);
  });

  it("throws (fail loud) when the bundle is missing — never silently drops tools", async () => {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = join(
      tmpdir(),
      "definitely-missing-relay-shim-bundle.js",
    );
    const sandbox = {
      mkdirFs: async () => {
        throw new Error("should not be called");
      },
      writeFsFile: async () => {
        throw new Error("should not be called");
      },
    };
    await assert.rejects(
      () => uploadRelayShimToSandbox(sandbox, "/home/sandbox/x"),
      new RegExp(RELAY_SHIM_UNAVAILABLE_MESSAGE),
    );
  });

  it("throws when the upload itself fails", async () => {
    const bundleDir = mkdtempSync(join(tmpdir(), "agenta-relay-shim-bundle-"));
    dirs.push(bundleDir);
    const bundlePath = join(bundleDir, "relay-mcp-stdio.js");
    writeFileSync(bundlePath, "// shim bundle", "utf-8");
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = bundlePath;
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async () => {
        throw new Error("sandbox FS write failed");
      },
    };
    await assert.rejects(
      () => uploadRelayShimToSandbox(sandbox, "/home/sandbox/x"),
      new RegExp(RELAY_SHIM_UNAVAILABLE_MESSAGE),
    );
  });
});
