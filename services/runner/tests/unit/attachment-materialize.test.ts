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
    const sandbox = {
      mkdirFs: async () => {},
      statFs: async () => {
        throw new Error("missing");
      },
      runProcess: async () => ({ exitCode: 1 }),
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
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const id = ids.find((candidate) => String(input).includes(candidate));
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
          filename: "untrusted.png",
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

    assert.ok(maxActive <= 2);
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
});
