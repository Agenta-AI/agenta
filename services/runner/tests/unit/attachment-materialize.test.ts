import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";

import {
  attachmentWorkingPath,
  materializeWorkingCopy,
  restoreReferencedWorkingCopies,
} from "../../src/engines/sandbox_agent/attachments.ts";

const ID_ONE = "019a52c2-14c0-7c14-b874-2f5798f9cd21";
const ID_TWO = "019a52c2-14c0-7c14-b874-2f5798f9cd22";
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "agenta-attachment-write-"));
  roots.push(value);
  return value;
}

describe("attachment materialization", () => {
  it("writes a missing local working copy", async () => {
    const cwd = root();
    const ref = { attachmentId: ID_ONE, filename: "photo.png" };
    assert.equal(
      await materializeWorkingCopy(
        {},
        { cwd, isDaytona: false },
        ref,
        new Uint8Array([1, 2, 3]),
      ),
      "written",
    );
    assert.deepEqual(
      readFileSync(attachmentWorkingPath(cwd, ref).absolute),
      Buffer.from([1, 2, 3]),
    );
  });

  it("never overwrites an existing local working copy", async () => {
    const cwd = root();
    const ref = { attachmentId: ID_ONE, filename: "photo.png" };
    await materializeWorkingCopy(
      {},
      { cwd, isDaytona: false },
      ref,
      new Uint8Array([1]),
    );
    const path = attachmentWorkingPath(cwd, ref).absolute;
    writeFileSync(path, Buffer.from([9, 9]));

    assert.equal(
      await materializeWorkingCopy(
        {},
        { cwd, isDaytona: false },
        ref,
        new Uint8Array([2]),
      ),
      "exists",
    );
    assert.deepEqual(readFileSync(path), Buffer.from([9, 9]));
  });

  it("namespaces equal filenames by attachment id", async () => {
    const cwd = root();
    const first = { attachmentId: ID_ONE, filename: "same.txt" };
    const second = { attachmentId: ID_TWO, filename: "same.txt" };
    await materializeWorkingCopy(
      {},
      { cwd, isDaytona: false },
      first,
      new Uint8Array([1]),
    );
    await materializeWorkingCopy(
      {},
      { cwd, isDaytona: false },
      second,
      new Uint8Array([2]),
    );
    assert.notEqual(
      attachmentWorkingPath(cwd, first).absolute,
      attachmentWorkingPath(cwd, second).absolute,
    );
  });

  it("writes identical bytes through the Daytona filesystem API", async () => {
    const written = new Map<string, Uint8Array>();
    const operations: string[] = [];
    const sandbox = {
      mkdirFs: async () => {
        operations.push("mkdir");
      },
      statFs: async () => {
        throw new Error("missing");
      },
      runProcess: async ({ timeoutMs }: { timeoutMs?: number }) => {
        operations.push(`symlink-check:${timeoutMs}`);
        return { exitCode: 1 };
      },
      writeFsFile: async (
        { path }: { path: string },
        body: Uint8Array,
      ) => {
        written.set(path, new Uint8Array(body));
      },
    };
    const cwd = "/home/sandbox/cwd";
    const ref = { attachmentId: ID_ONE, filename: "photo.png" };
    const bytes = new Uint8Array([4, 5, 6]);

    assert.equal(
      await materializeWorkingCopy(
        sandbox,
        { cwd, isDaytona: true },
        ref,
        bytes,
      ),
      "written",
    );
    assert.deepEqual(
      written.get(attachmentWorkingPath(cwd, ref).absolute),
      bytes,
    );
    assert.deepEqual(operations, [
      "symlink-check:15000",
      "symlink-check:15000",
      "symlink-check:15000",
      "mkdir",
    ]);
  });

  it("refuses to write when the Daytona symlink check reports no exit code", async () => {
    let written = 0;
    const sandbox = {
      mkdirFs: async () => {},
      statFs: async () => {
        throw new Error("missing");
      },
      runProcess: async () => undefined,
      writeFsFile: async () => {
        written += 1;
      },
    };

    await assert.rejects(
      materializeWorkingCopy(
        sandbox,
        { cwd: "/home/sandbox/cwd", isDaytona: true },
        { attachmentId: ID_ONE, filename: "photo.png" },
        new Uint8Array([1]),
      ),
      /did not report an exit code/,
    );
    assert.equal(written, 0);
  });

  it("restores referenced copies with bounded concurrency and never overwrites", async () => {
    const cwd = root();
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    const existing = { attachmentId: ids[0], filename: `.png` };
    await materializeWorkingCopy(
      {},
      { cwd, isDaytona: false },
      existing,
      new Uint8Array([9]),
    );
    let active = 0;
    let maxActive = 0;
    const fetchedIds: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const id = ids.find((candidate) => String(input).includes(candidate));
      if (id) fetchedIds.push(id);
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-disposition": `attachment; filename*=UTF-8''.png`,
        },
      });
    });
    const messages = [
      {
        role: "user",
        content: ids.map((attachmentId) => ({
          type: "attachment",
          attachmentId,
          filename: attachmentId === ids[0] ? ".png" : "untrusted.png",
        })),
      },
    ];

    const restored = await restoreReferencedWorkingCopies(
      {},
      { cwd, isDaytona: false },
      messages,
      "session-1",
      () => "ApiKey test",
      { concurrency: 2, timeoutMs: 1_000 },
    );

    assert.equal(maxActive, 2, "the pool runs at the configured concurrency");
    assert.equal(fetchedIds.includes(ids[0]), false, "existing copy skips fetch");
    assert.equal(fetchedIds.length, ids.length - 1);
    assert.deepEqual(
      readFileSync(attachmentWorkingPath(cwd, existing).absolute),
      Buffer.from([9]),
    );
    assert.equal(
      Array.isArray(restored[0].content)
        ? restored[0].content[0].filename
        : undefined,
      `.png`,
    );
  });

  it("a failed historical restore is survivable", async () => {
    const cwd = root();
    const logs: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes(ID_ONE)) {
        return new Response("gone", { status: 404 });
      }
      return new Response(new Uint8Array([7, 8]), {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "content-disposition": "attachment; filename=healthy.txt",
        },
      });
    });
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "attachment",
            attachmentId: ID_ONE,
            filename: "report.pdf",
          },
          {
            type: "attachment",
            attachmentId: ID_TWO,
            filename: "healthy.txt",
          },
        ],
      },
    ];

    const restored = await restoreReferencedWorkingCopies(
      {},
      { cwd, isDaytona: false },
      messages,
      "session-1",
      () => "ApiKey test",
      { log: (message) => logs.push(message) },
    );

    assert.deepEqual(
      readFileSync(
        attachmentWorkingPath(cwd, {
          attachmentId: ID_TWO,
          filename: "healthy.txt",
        }).absolute,
      ),
      Buffer.from([7, 8]),
    );
    assert.equal(
      Array.isArray(restored[0].content)
        ? restored[0].content[0].text
        : undefined,
      "[attached file: report.pdf - no longer available]",
    );
    assert.ok(
      logs.some(
        (message) =>
          message.includes(ID_ONE) && message.includes("no longer available"),
      ),
    );
  });
});
