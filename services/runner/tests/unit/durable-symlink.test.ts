/**
 * Unit tests for the shared durable-cwd symlink helper: the object-store hazard where a symlink
 * comes back from a flush/remount round trip as an ordinary empty file.
 *
 * Run: pnpm exec vitest run tests/unit/durable-symlink.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureDurableSymlink } from "../../src/engines/sandbox_agent/durable-symlink.ts";

const SILENT = () => {};

describe("ensureDurableSymlink (real filesystem)", () => {
  let dir: string;
  let target: string;
  let linkPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "durable-symlink-"));
    target = join(dir, "target");
    linkPath = join(dir, "link");
    writeFileSync(target, "payload");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the link when nothing is there", async () => {
    assert.equal(
      await ensureDurableSymlink(linkPath, target, "test", { log: SILENT }),
      "linked",
    );
    assert.equal(readlinkSync(linkPath), target);
  });

  it("replaces the 0-byte file a geesefs round trip leaves behind", async () => {
    writeFileSync(linkPath, "");

    assert.equal(
      await ensureDurableSymlink(linkPath, target, "test", { log: SILENT }),
      "linked",
    );
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(readlinkSync(linkPath), target);
  });

  it("replaces a symlink pointing at the wrong target", async () => {
    symlinkSync(join(dir, "somewhere-else"), linkPath);

    assert.equal(
      await ensureDurableSymlink(linkPath, target, "test", { log: SILENT }),
      "linked",
    );
    assert.equal(readlinkSync(linkPath), target);
  });

  it("keeps a correct link, including a dangling one", async () => {
    rmSync(target);
    symlinkSync(target, linkPath);
    const before = lstatSync(linkPath).ino;

    assert.equal(
      await ensureDurableSymlink(linkPath, target, "test", { log: SILENT }),
      "kept",
    );
    assert.equal(lstatSync(linkPath).ino, before);
  });
});

describe("ensureDurableSymlink (injected failures)", () => {
  it("logs a non-ENOENT lstat failure and links nothing", async () => {
    const logs: string[] = [];
    let linked = false;
    const outcome = await ensureDurableSymlink(
      "/tmp/run/link",
      "/tmp/tgt",
      "thing",
      {
        lstat: (async () => {
          throw Object.assign(new Error("permission denied"), {
            code: "EACCES",
          });
        }) as never,
        symlink: (async () => {
          linked = true;
        }) as never,
        log: (msg) => logs.push(msg),
      },
    );

    assert.equal(outcome, "failed");
    assert.equal(linked, false);
    assert.deepEqual(logs.length, 1);
    assert.match(
      logs[0],
      /thing check failed \/tmp\/run\/link: permission denied/,
    );
  });

  it("treats a concurrent creator's EEXIST as success", async () => {
    const logs: string[] = [];
    const outcome = await ensureDurableSymlink(
      "/tmp/run/link",
      "/tmp/tgt",
      "thing",
      {
        lstat: (async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }) as never,
        symlink: (async () => {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }) as never,
        log: (msg) => logs.push(msg),
      },
    );

    assert.equal(outcome, "linked");
    assert.deepEqual(logs, []);
  });

  it("logs a symlink failure without throwing", async () => {
    const logs: string[] = [];
    const outcome = await ensureDurableSymlink(
      "/tmp/run/link",
      "/tmp/tgt",
      "thing",
      {
        lstat: (async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }) as never,
        symlink: (async () => {
          throw new Error("not supported");
        }) as never,
        log: (msg) => logs.push(msg),
      },
    );

    assert.equal(outcome, "failed");
    assert.equal(logs.length, 1);
    assert.match(logs[0], /thing link failed/);
  });

  it("unlinks the degraded entry before relinking, and logs an unlink failure", async () => {
    const calls: string[][] = [];
    const logs: string[] = [];
    const outcome = await ensureDurableSymlink(
      "/tmp/run/link",
      "/tmp/tgt",
      "thing",
      {
        lstat: (async () => ({ isSymbolicLink: () => false })) as never,
        unlink: (async (path: string) => {
          calls.push(["unlink", path]);
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        }) as never,
        symlink: (async (t: string, path: string) => {
          calls.push(["symlink", t, path]);
        }) as never,
        log: (msg) => logs.push(msg),
      },
    );

    assert.equal(outcome, "linked");
    assert.deepEqual(calls, [
      ["unlink", "/tmp/run/link"],
      ["symlink", "/tmp/tgt", "/tmp/run/link"],
    ]);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /thing unlink failed/);
  });

  it("does not read EEXIST as success when the unlink failed", async () => {
    // The degraded entry could not be removed, so EEXIST here is that same entry still blocking
    // the path — NOT a concurrent creator. Reporting "linked" would tell the caller a 0-byte
    // auth.json had been repaired while it is still sitting there (issue #5692).
    const logs: string[] = [];
    const outcome = await ensureDurableSymlink(
      "/tmp/run/link",
      "/tmp/tgt",
      "thing",
      {
        lstat: (async () => ({ isSymbolicLink: () => false })) as never,
        unlink: (async () => {
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        }) as never,
        symlink: (async () => {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }) as never,
        log: (msg) => logs.push(msg),
      },
    );

    assert.equal(outcome, "failed");
    assert.equal(logs.length, 2);
    assert.match(logs[0], /thing unlink failed/);
    assert.match(logs[1], /thing link failed/);
  });

  it("still reads EEXIST as success when the unlink itself succeeded", async () => {
    // A real race: the entry was removed, then a concurrent creator won. The link is there.
    const logs: string[] = [];
    const outcome = await ensureDurableSymlink(
      "/tmp/run/link",
      "/tmp/tgt",
      "thing",
      {
        lstat: (async () => ({ isSymbolicLink: () => false })) as never,
        unlink: (async () => {}) as never,
        symlink: (async () => {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }) as never,
        log: (msg) => logs.push(msg),
      },
    );

    assert.equal(outcome, "linked");
    assert.deepEqual(logs, []);
  });
});
