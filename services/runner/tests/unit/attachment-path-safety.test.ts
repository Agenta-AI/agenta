import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";

import {
  attachmentWorkingPath,
  materializeWorkingCopy,
} from "../../src/engines/sandbox_agent/attachments.ts";

const ATTACHMENT_ID = "019a52c2-14c0-7c14-b874-2f5798f9cd21";
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "agenta-attachment-path-"));
  roots.push(value);
  return value;
}

describe("attachment path safety", () => {
  it("rejects a non-UUID id before constructing a working path", () => {
    assert.throws(
      () =>
        attachmentWorkingPath(root(), {
          attachmentId: "../escape",
          filename: "safe.txt",
        }),
      /canonical UUID/,
    );
  });

  it("rejects separators and dot path components in filenames", () => {
    for (const filename of ["nested/file.txt", "nested\\file.txt", ".", ".."]) {
      assert.throws(
        () =>
          attachmentWorkingPath(root(), {
            attachmentId: ATTACHMENT_ID,
            filename,
          }),
        /safe basename/,
      );
    }
  });

  it("keeps the resolved path under cwd/attachments", () => {
    const cwd = root();
    const path = attachmentWorkingPath(cwd, {
      attachmentId: ATTACHMENT_ID,
      filename: "safe.txt",
    });
    assert.equal(path.absolute.startsWith(path.root + "/"), true);
    assert.equal(
      path.relative,
      "attachments/" + ATTACHMENT_ID + "/safe.txt",
    );
  });

  it("rejects a symlinked parent component", async () => {
    const cwd = root();
    const outside = join(cwd, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(cwd, "attachments"));

    await assert.rejects(
      () =>
        materializeWorkingCopy(
          {},
          { workspace: { cwd }, isDaytona: false },
          { attachmentId: ATTACHMENT_ID, filename: "safe.txt" },
          new Uint8Array([1]),
        ),
      /symbolic link/,
    );
  });
});
