/**
 * Atomic relay publication (event-driven-tool-relay slice 1, plan decision 2).
 *
 * Both relay directions publish via a temp name plus a same-directory rename, so a
 * reader or watcher can never observe partial JSON: the writer's request in
 * tools/relay-client.ts, and the runner's response in tools/relay.ts through the
 * `RelayHost.rename` capability. These tests pin the temp-name scheme's invisibility to
 * the suffix filters, the absence of temp residue, the runner's write-then-rename order,
 * and the Daytona host's rename -> moveFs mapping.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/relay-atomic-publish.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { publishRelayRequest } from "../../src/tools/relay-client.ts";
import {
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  relayTempPath,
  sleep,
} from "../../src/tools/relay-protocol.ts";
import {
  localRelayHost,
  sandboxRelayHost,
  startToolRelay,
  type RelayHost,
} from "../../src/tools/relay.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "agenta-relay-atomic-test-"));

describe("relayTempPath", () => {
  it("never matches the req/res suffix filters", () => {
    for (const finalPath of [
      `/relay/call-1${RELAY_REQ_SUFFIX}`,
      `/relay/call-1${RELAY_RES_SUFFIX}`,
    ]) {
      const tmp = relayTempPath(finalPath);
      assert.ok(tmp.startsWith(`${finalPath}.tmp.`), tmp);
      assert.ok(
        !tmp.endsWith(RELAY_REQ_SUFFIX),
        "invisible to the .req.json filter",
      );
      assert.ok(
        !tmp.endsWith(RELAY_RES_SUFFIX),
        "invisible to the .res.json filter",
      );
    }
  });

  it("uses a fresh nonce per call", () => {
    const finalPath = `/relay/x${RELAY_REQ_SUFFIX}`;
    assert.notEqual(relayTempPath(finalPath), relayTempPath(finalPath));
  });
});

describe("publishRelayRequest (atomic request publication)", () => {
  it("leaves only the final name in the dir — no *.tmp.* residue", () => {
    const dir = tempDir();
    try {
      publishRelayRequest(dir, {
        toolName: "x",
        toolCallId: "call-1",
        args: { a: 1 },
      });
      assert.deepEqual(readdirSync(dir), [`call-1${RELAY_REQ_SUFFIX}`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("startToolRelay response publication (write temp, then rename)", () => {
  it("writes the full response to a non-.res.json path and renames it to <id>.res.json", async () => {
    const relayDir = "/relay";
    const reqName = `call-1${RELAY_REQ_SUFFIX}`;
    const ops: Array<{
      op: "read" | "remove" | "write" | "rename";
      path: string;
      extra: string;
    }> = [];
    // The request appears on the SECOND list: the first list feeds the stale-file
    // sweep (a relay file already present there is cleared as pre-turn residue,
    // never executed) — mirroring production, where the loop starts before the prompt.
    let listCalls = 0;
    const host: RelayHost = {
      list: async () => (++listCalls === 2 ? [reqName] : []),
      read: async (path) => {
        ops.push({ op: "read", path, extra: "" });
        return JSON.stringify({
          toolName: "nope",
          toolCallId: "call-1",
          args: {},
        });
      },
      remove: async (path) => void ops.push({ op: "remove", path, extra: "" }),
      write: async (path, contents) =>
        void ops.push({ op: "write", path, extra: contents }),
      rename: async (from, to) =>
        void ops.push({ op: "rename", path: from, extra: to }),
    };

    // No spec named "nope" is registered, so the relay answers with an ok:false
    // response — which exercises the publication path without any network.
    const relay = startToolRelay(host, relayDir, [], undefined);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !ops.some((o) => o.op === "rename")) {
      await sleep(10);
    }
    await relay.stop();

    // Full pickup-to-publication order: read the request, remove it (delete-on-pickup,
    // so the watch exec cannot insta-wake on it for the whole execution), write the
    // response under a temp name, then rename it to the final name.
    assert.deepEqual(
      ops.map((o) => o.op),
      ["read", "remove", "write", "rename"],
      "read -> remove(req) -> write(tmp) -> rename(final)",
    );
    const reqPath = `${relayDir}/${reqName}`;
    assert.equal(ops[0].path, reqPath, "reads the request file");
    assert.equal(ops[1].path, reqPath, "removes exactly the request file");
    const [, , write, rename] = ops;
    const finalResPath = `${relayDir}/call-1${RELAY_RES_SUFFIX}`;
    assert.ok(
      write.path.startsWith(`${finalResPath}.tmp.`),
      `temp write path: ${write.path}`,
    );
    assert.ok(
      !write.path.endsWith(RELAY_RES_SUFFIX),
      "the written path is invisible to the .res.json filter",
    );
    assert.equal(
      rename.path,
      write.path,
      "renames exactly the written temp file",
    );
    assert.equal(rename.extra, finalResPath, "renames to the exact final name");
    const res = JSON.parse(write.extra);
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown tool 'nope'/);
  });
});

describe("RelayHost rename implementations", () => {
  it("localRelayHost.rename renames on the local filesystem", async () => {
    const dir = tempDir();
    try {
      const from = join(dir, "x.tmp.abc");
      const to = join(dir, `x${RELAY_RES_SUFFIX}`);
      writeFileSync(from, '{"ok":true}', "utf-8");
      await localRelayHost().rename(from, to);
      assert.deepEqual(readdirSync(dir), [`x${RELAY_RES_SUFFIX}`]);
      assert.equal(readFileSync(to, "utf-8"), '{"ok":true}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sandboxRelayHost.rename calls the daemon's moveFs with overwrite", async () => {
    const calls: unknown[] = [];
    const sandbox = {
      moveFs: async (arg: unknown) => void calls.push(arg),
    };
    await sandboxRelayHost(sandbox).rename("/relay/x.tmp.abc", "/relay/x");
    assert.deepEqual(calls, [
      { from: "/relay/x.tmp.abc", to: "/relay/x", overwrite: true },
    ]);
  });
});

describe("RelayHost remove implementations (delete-on-pickup)", () => {
  it("localRelayHost.remove unlinks the file on the local filesystem", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, `x${RELAY_REQ_SUFFIX}`);
      writeFileSync(path, "{}", "utf-8");
      await localRelayHost().remove(path);
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("localRelayHost.remove throws on a missing file (call sites guard)", async () => {
    const dir = tempDir();
    try {
      await assert.rejects(localRelayHost().remove(join(dir, "missing.json")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sandboxRelayHost.remove calls the daemon's deleteFsEntry", async () => {
    const calls: unknown[] = [];
    const sandbox = {
      deleteFsEntry: async (arg: unknown) => void calls.push(arg),
    };
    await sandboxRelayHost(sandbox).remove("/relay/x.req.json");
    assert.deepEqual(calls, [{ path: "/relay/x.req.json" }]);
  });
});
