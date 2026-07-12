/**
 * Unit tests for the in-sandbox stdio MCP shim asset upload
 * (src/engines/sandbox_agent/tool-mcp-assets.ts).
 *
 * The upload is FAIL-LOUD on the path that requires it: a missing bundle or a failed upload
 * throws `TOOL_MCP_UNAVAILABLE_MESSAGE` (the engine turns it into `{ok:false,error}`), rather
 * than silently dropping the run's tools — exactly the silent drop the F1/F-042 gates forbid.
 * A success writes BOTH files (bundle + specs JSON) and returns both in-sandbox paths; it
 * always writes (never skip-if-exists), so a warm-reused sandbox cannot keep a stale bundle
 * from before a runner deploy.
 *
 * Run: pnpm exec vitest run tests/unit/tool-mcp-assets.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TOOL_MCP_UNAVAILABLE_MESSAGE,
  toolMcpBundlePath,
  uploadToolMcpAssets,
} from "../../src/engines/sandbox_agent/tool-mcp-assets.ts";
import type { AdvertisedToolSpec } from "../../src/tools/public-spec.ts";

const specs: AdvertisedToolSpec[] = [
  {
    name: "get_weather",
    description: "Get the weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
    timeoutMs: 5_000,
  },
];

const dirs: string[] = [];
const prevBundle = process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (prevBundle === undefined) {
    delete process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE;
  } else {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = prevBundle;
  }
});

function fixtureBundle(): string {
  const bundleDir = mkdtempSync(join(tmpdir(), "agenta-tool-mcp-bundle-"));
  dirs.push(bundleDir);
  const bundlePath = join(bundleDir, "tool-mcp-stdio.js");
  writeFileSync(bundlePath, "// shim bundle", "utf-8");
  return bundlePath;
}

describe("uploadToolMcpAssets", () => {
  it("resolves the bundle override lazily, at call time", () => {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = "/fixtures/a.js";
    assert.equal(toolMcpBundlePath(), "/fixtures/a.js");
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = "/fixtures/b.js";
    assert.equal(toolMcpBundlePath(), "/fixtures/b.js");
    delete process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE;
    assert.match(toolMcpBundlePath(), /dist\/tools\/tool-mcp-stdio\.js$/);
  });

  it("uploads bundle + specs file (always writes) and returns both in-sandbox paths", async () => {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = fixtureBundle();

    const calls: Array<{ op: string; path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    const destDir = "/home/sandbox/agenta/tool-mcp/agenta-abc";
    const assets = await uploadToolMcpAssets(sandbox, destDir, specs);
    assert.deepEqual(assets, {
      bundlePath: `${destDir}/tool-mcp-stdio.js`,
      specsPath: `${destDir}/tool-mcp-specs.json`,
    });
    assert.deepEqual(calls, [
      { op: "mkdir", path: destDir },
      {
        op: "write",
        path: `${destDir}/tool-mcp-stdio.js`,
        body: "// shim bundle",
      },
      {
        op: "write",
        path: `${destDir}/tool-mcp-specs.json`,
        body: JSON.stringify(specs),
      },
    ]);
    // The specs file round-trips the AdvertisedToolSpec array (the shim's input contract).
    const written = JSON.parse(calls[2].body ?? "");
    assert.deepEqual(written, specs);
  });

  it("throws (fail loud) when the bundle is missing — never silently drops tools", async () => {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = join(
      tmpdir(),
      "definitely-missing-tool-mcp-bundle.js",
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
      () => uploadToolMcpAssets(sandbox, "/home/sandbox/x", specs),
      new RegExp(TOOL_MCP_UNAVAILABLE_MESSAGE),
    );
  });

  it("throws when the upload itself fails (bundle write)", async () => {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = fixtureBundle();
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async () => {
        throw new Error("sandbox FS write failed");
      },
    };
    await assert.rejects(
      () => uploadToolMcpAssets(sandbox, "/home/sandbox/x", specs),
      new RegExp(TOOL_MCP_UNAVAILABLE_MESSAGE),
    );
  });

  it("throws when the specs-file write fails (partial delivery is still a failure)", async () => {
    process.env.SANDBOX_AGENT_RELAY_MCP_BUNDLE = fixtureBundle();
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }) => {
        if (path.endsWith("tool-mcp-specs.json")) {
          throw new Error("sandbox FS write failed");
        }
      },
    };
    await assert.rejects(
      () => uploadToolMcpAssets(sandbox, "/home/sandbox/x", specs),
      new RegExp(TOOL_MCP_UNAVAILABLE_MESSAGE),
    );
  });
});
