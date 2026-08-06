/**
 * The workspace import reader and the `@ag.file` resolution step (slice S3a).
 *
 * Contract: docs/design/agent-config-editing/contracts/workspace-import.md sections 2, 3,
 * 4.4, 6, 7, and change-set.md sections 6.1, 6.3, 6.5, 6.6.
 *
 * The local tests use a real temporary directory, including real symbolic links, because
 * the properties under test are filesystem properties: a mocked fs would prove nothing
 * about confinement. The Daytona tests drive a fake exec that returns the exact byte
 * framing `find -printf` produces.
 *
 * Run: pnpm exec vitest run tests/unit/workspace-import.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  IMPORT_ROOT,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  isResolvedDescendant,
  resolveImportPath,
} from "../../src/tools/import-paths.ts";
import {
  DaytonaWorkspaceReader,
  ImportError,
  LocalWorkspaceReader,
  digestOf,
  parseManifest,
  type DaytonaExec,
} from "../../src/tools/workspace-reader.ts";
import {
  MarkerResolutionError,
  findAllMarkers,
  resolveFileMarkers,
} from "../../src/tools/file-markers.ts";

// ---------------------------------------------------------------------------
// Lexical path rules (contract 3.1 + change-set.md 6.3)
// ---------------------------------------------------------------------------

const CWD = "/workspace";

describe("resolveImportPath", () => {
  it("accepts a path relative to the import root", () => {
    const result = resolveImportPath("pdf-tools/SKILL.md", CWD);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.segments, ["pdf-tools", "SKILL.md"]);
  });

  it("accepts a path relative to the workspace root", () => {
    const result = resolveImportPath(`${IMPORT_ROOT}/pdf-tools/SKILL.md`, CWD);
    assert.equal(result.ok && result.relativePath, "pdf-tools/SKILL.md");
  });

  it("accepts an absolute path inside the workspace", () => {
    // Agents write absolute paths naturally; refusing them fights the model, so the
    // runner normalizes instead (change-set.md 6.3).
    const result = resolveImportPath(
      `${CWD}/${IMPORT_ROOT}/pdf-tools/SKILL.md`,
      CWD,
    );
    assert.equal(result.ok && result.relativePath, "pdf-tools/SKILL.md");
  });

  it("refuses an absolute path outside the workspace", () => {
    const result = resolveImportPath("/etc/passwd", CWD);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "path_outside_workspace");
  });

  it("refuses a traversal segment", () => {
    assert.equal(
      (resolveImportPath("../secrets/key", CWD) as { reason: string }).reason,
      "path_traversal",
    );
  });

  it("refuses a traversal that only escapes after normalization", () => {
    // `a/../../b` normalizes to `../b`. Checking the raw segments catches it; checking
    // the normalized string would have collapsed the escape out of sight.
    assert.equal(
      (resolveImportPath("a/../../b", CWD) as { reason: string }).reason,
      "path_traversal",
    );
  });

  it("refuses a NUL byte", () => {
    assert.equal(
      (resolveImportPath("pdf\0tools/SKILL.md", CWD) as { reason: string })
        .reason,
      "path_nul",
    );
  });

  it("refuses a backslash", () => {
    assert.equal(
      (resolveImportPath("pdf\\tools", CWD) as { reason: string }).reason,
      "path_backslash",
    );
  });

  it("refuses an over-long path", () => {
    assert.equal(
      (resolveImportPath("a".repeat(1100), CWD) as { reason: string }).reason,
      "path_too_long",
    );
  });

  it("refuses the root itself", () => {
    // The caller must name a file, not the folder.
    assert.equal(
      (resolveImportPath(IMPORT_ROOT, CWD) as { reason: string }).reason,
      "path_is_root",
    );
  });

  it("refuses a path deeper than the walk", () => {
    const deep = Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `d${i}`).join(
      "/",
    );
    assert.equal(
      (resolveImportPath(deep, CWD) as { reason: string }).reason,
      "path_too_deep",
    );
  });

  it("refuses an empty path", () => {
    assert.equal(
      (resolveImportPath("", CWD) as { reason: string }).reason,
      "path_empty",
    );
  });
});

describe("isResolvedDescendant", () => {
  it("accepts the root itself and anything below it", () => {
    assert.equal(
      isResolvedDescendant("/w/.agenta-imports", "/w/.agenta-imports"),
      true,
    );
    assert.equal(
      isResolvedDescendant("/w/.agenta-imports/a/b", "/w/.agenta-imports"),
      true,
    );
  });

  it("rejects a sibling whose name starts with the root's name", () => {
    // The classic prefix bug: `/w/.agenta-imports-evil` starts with the root string but
    // is not under it.
    assert.equal(
      isResolvedDescendant("/w/.agenta-imports-evil/x", "/w/.agenta-imports"),
      false,
    );
  });

  it("rejects an unrelated path", () => {
    assert.equal(
      isResolvedDescendant("/etc/passwd", "/w/.agenta-imports"),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The local reader (contract 3.2, 3.4, 3.5)
// ---------------------------------------------------------------------------

describe("LocalWorkspaceReader", () => {
  let cwd: string;
  let root: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-import-"));
    root = join(cwd, IMPORT_ROOT);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function reader() {
    return new LocalWorkspaceReader(cwd);
  }

  it("reads a file and reports its bytes and digest", async () => {
    mkdirSync(join(root, "pdf-tools"));
    writeFileSync(join(root, "pdf-tools", "SKILL.md"), "# PDF tools\n");

    const file = await reader().readImportFile("pdf-tools/SKILL.md");
    assert.equal(file.content, "# PDF tools\n");
    assert.equal(file.bytes, 12);
    assert.equal(file.digest, digestOf("# PDF tools\n"));
    assert.equal(file.relativePath, "pdf-tools/SKILL.md");
  });

  it("reads through several directory levels", async () => {
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, "a", "b", "c", "x.py"), "print(1)\n");
    const file = await reader().readImportFile("a/b/c/x.py");
    assert.equal(file.content, "print(1)\n");
  });

  it("reports the executable bit without acting on it", async () => {
    // Contract 5.3: the bit is data the card shows, never a grant the runner derives.
    writeFileSync(join(root, "run.sh"), "echo hi\n");
    chmodSync(join(root, "run.sh"), 0o755);
    const file = await reader().readImportFile("run.sh");
    assert.equal(file.executableBit, true);
  });

  it("refuses a symbolic link in place of the import ROOT", async () => {
    // The root is opened before the descriptor walk starts, so a link here would be followed and
    // every confined open below it would be confined to the ATTACKER's directory instead of the
    // workspace. Without O_NOFOLLOW on the root open this read succeeds.
    const outside = mkdtempSync(join(tmpdir(), "agenta-outside-"));
    writeFileSync(join(outside, "id_rsa"), "PRIVATE KEY MATERIAL\n");
    rmSync(root, { recursive: true, force: true });
    symlinkSync(outside, root);
    try {
      await assert.rejects(
        () => reader().readImportFile("id_rsa"),
        (error: ImportError) => {
          assert.equal(error.code, "source_invalid");
          assert.match(error.message, /symbolic link/);
          return true;
        },
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses a root symlink even when its target stays INSIDE the workspace", async () => {
    // Staying inside the workspace is not the property the root check defends. A link is refused
    // for its own sake, so the reader never has to reason about where a link points.
    const inside = join(cwd, "real-imports");
    mkdirSync(inside);
    writeFileSync(join(inside, "notes.md"), "inside\n");
    rmSync(root, { recursive: true, force: true });
    symlinkSync(inside, root);

    await assert.rejects(
      () => reader().readImportFile("notes.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_invalid");
        assert.match(error.message, /symbolic link/);
        return true;
      },
    );
  });

  it("refuses a symbolic link at the final component", async () => {
    writeFileSync(join(cwd, "secret.txt"), "top secret\n");
    symlinkSync(join(cwd, "secret.txt"), join(root, "link.txt"));

    await assert.rejects(
      () => reader().readImportFile("link.txt"),
      (error: ImportError) => {
        assert.equal(error.code, "source_unsupported_content");
        assert.match(error.message, /symbolic link/);
        return true;
      },
    );
  });

  it("refuses a symbolic link used as an INTERMEDIATE directory", async () => {
    // This is the attack the descriptor walk exists to stop, and the one a path-based
    // walk with O_NOFOLLOW misses: the flag only guards the final component.
    mkdirSync(join(cwd, "outside"), { recursive: true });
    writeFileSync(join(cwd, "outside", "x.py"), "stolen\n");
    symlinkSync(join(cwd, "outside"), join(root, "scripts"));

    await assert.rejects(
      () => reader().readImportFile("scripts/x.py"),
      (error: ImportError) => {
        assert.equal(error.code, "source_unsupported_content");
        return true;
      },
    );
  });

  it("refuses a directory", async () => {
    mkdirSync(join(root, "pdf-tools"));
    await assert.rejects(
      () => reader().readImportFile("pdf-tools"),
      (error: ImportError) => {
        assert.equal(error.code, "source_invalid");
        return true;
      },
    );
  });

  it("refuses a file above the size cap", async () => {
    writeFileSync(join(root, "big.md"), "a".repeat(MAX_FILE_BYTES + 1));
    await assert.rejects(
      () => reader().readImportFile("big.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_too_large");
        return true;
      },
    );
  });

  it("refuses a binary file", async () => {
    writeFileSync(
      join(root, "logo.png"),
      Buffer.from([0x89, 0x50, 0x00, 0x01]),
    );
    await assert.rejects(
      () => reader().readImportFile("logo.png"),
      (error: ImportError) => {
        assert.equal(error.code, "source_unsupported_content");
        return true;
      },
    );
  });

  // Malformed UTF-8 (contract 4.2). The bytes that matter are the ones a U+FFFD test cannot
  // catch: the replacement character encodes as EF BF BD, so any rule that exempts a buffer
  // holding 0xEF lets a whole class of invalid sequences through as mojibake.
  for (const [name, bytes] of [
    ["an invalid sequence beginning with 0xEF", Buffer.from([0xef, 0x28])],
    [
      "valid text carrying a stray 0xEF",
      Buffer.concat([
        Buffer.from("hello "),
        Buffer.from([0xef, 0xff, 0xfe]),
        Buffer.from(" world"),
      ]),
    ],
    ["a truncated multi-byte sequence", Buffer.from([0xe2, 0x82])],
    ["an invalid sequence with no 0xEF at all", Buffer.from([0xc3, 0x28])],
  ] as const) {
    it(`refuses ${name}`, async () => {
      writeFileSync(join(root, "notes.md"), bytes);
      await assert.rejects(
        () => reader().readImportFile("notes.md"),
        (error: ImportError) => {
          assert.equal(error.code, "source_unsupported_content");
          assert.match(error.message, /not valid UTF-8/);
          return true;
        },
      );
    });
  }

  for (const [name, bytes] of [
    ["text holding a literal replacement character", Buffer.from("a � b")],
    [
      "text behind a byte-order mark",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("bom text")]),
    ],
  ] as const) {
    it(`imports ${name} byte for byte`, async () => {
      writeFileSync(join(root, "notes.md"), bytes);
      const file = await reader().readImportFile("notes.md");
      // The committed content must re-encode to the bytes on disk. A decoder that dropped the
      // BOM, or substituted anything, would leave `bytes` describing one thing and `digest`
      // another, and the card would show a size the commit does not carry.
      assert.deepEqual(Buffer.from(file.content, "utf8"), Buffer.from(bytes));
      assert.equal(file.bytes, bytes.byteLength);
      assert.equal(file.digest, digestOf(file.content));
    });
  }

  it("lists what exists when the file is missing", async () => {
    // A wrong path is nearly always a near miss, so the answer names what IS there.
    mkdirSync(join(root, "pdf-tools"));
    writeFileSync(join(root, "notes.md"), "x");

    await assert.rejects(
      () => reader().readImportFile("pdf-toolz/SKILL.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_not_found");
        assert.deepEqual(error.available, ["notes.md", "pdf-tools/"]);
        return true;
      },
    );
  });

  it("reports a missing import root without throwing a raw fs error", async () => {
    rmSync(root, { recursive: true, force: true });
    await assert.rejects(
      () => reader().readImportFile("a.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_not_found");
        return true;
      },
    );
  });

  it("refuses a path that escapes the root", async () => {
    writeFileSync(join(cwd, "secret.txt"), "top secret\n");
    await assert.rejects(
      () => reader().readImportFile("../secret.txt"),
      (error: ImportError) => {
        assert.equal(error.code, "source_invalid");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// The Daytona reader (contract 6.2)
// ---------------------------------------------------------------------------

function framed(records: Array<[string, string, string, string]>): Buffer {
  return Buffer.from(records.map((r) => r.join("\0") + "\0").join(""), "utf8");
}

function fakeExec(
  handlers: Record<string, () => { stdout: Buffer; exitCode: number }>,
) {
  const calls: string[][] = [];
  const exec: DaytonaExec = async (argv) => {
    calls.push(argv);
    const key = argv[0] === "find" ? findKey(argv) : argv[0];
    const handler = handlers[key];
    if (!handler) return { stdout: Buffer.alloc(0), exitCode: 1 };
    return handler();
  };
  return { exec, calls };
}

function findKey(argv: string[]): string {
  if (argv.includes("-quit")) return "find:probe";
  if (
    argv.includes("-maxdepth") &&
    argv[argv.indexOf("-maxdepth") + 1] === "0"
  ) {
    return "find:stat";
  }
  return "find:list";
}

describe("parseManifest", () => {
  it("parses NUL-framed records", () => {
    const entries = parseManifest(
      framed([
        ["d", "755", "4096", "pdf-tools"],
        ["f", "644", "12", "pdf-tools/SKILL.md"],
      ]),
    );
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[1], {
      type: "f",
      mode: "644",
      size: 12,
      relativePath: "pdf-tools/SKILL.md",
    });
  });

  it("survives a name holding a newline, a tab, and a quote", () => {
    // NUL is the only separator a file name cannot contain, which is why the framing uses
    // it; the prototype's tab-and-newline framing would split this record apart.
    const nasty = 'we\nird\tname"here';
    const entries = parseManifest(framed([["f", "644", "3", nasty]]));
    assert.equal(entries[0].relativePath, nasty);
  });

  it("ignores the empty tail field", () => {
    assert.equal(parseManifest(framed([["f", "644", "1", "a"]])).length, 1);
  });
});

describe("DaytonaWorkspaceReader", () => {
  const cwd = "/workspace";
  const abs = `${cwd}/${IMPORT_ROOT}`;

  /**
   * A reader over a fake sandbox. `types` names the OWN type (`%y`) of any path the walk asks
   * about; a path with no entry is a directory, except the last one, which is the file. `realpath`
   * defaults to identity, so the descendant tests compare a path against itself resolved.
   */
  function daytonaReader(options: {
    types?: Record<string, string>;
    realpath?: (target: string) => string;
    content?: string;
  } = {}) {
    const calls: string[][] = [];
    const reader = new DaytonaWorkspaceReader(cwd, async (argv) => {
      calls.push(argv);
      if (argv[0] === "realpath") {
        const resolved = (options.realpath ?? ((t: string) => t))(
          argv[argv.length - 1],
        );
        return { stdout: Buffer.from(`${resolved}\n`), exitCode: 0 };
      }
      if (argv[0] === "find" && findKey(argv) === "find:stat") {
        const paths = argv.slice(1, argv.indexOf("-maxdepth"));
        return {
          stdout: framed(
            paths.map((target, index) => [
              options.types?.[target] ??
                (index === paths.length - 1 ? "f" : "d"),
              "644",
              "5",
              "",
            ]),
          ),
          exitCode: 0,
        };
      }
      if (argv[0] === "cat") {
        return {
          stdout: Buffer.from(options.content ?? "hello"),
          exitCode: 0,
        };
      }
      return { stdout: Buffer.alloc(0), exitCode: 1 };
    });
    return { reader, calls };
  }

  it("reads a file that passes the descendant test", async () => {
    const { reader, calls } = daytonaReader({ content: "hello" });

    const file = await reader.readImportFile("pdf-tools/SKILL.md");
    assert.equal(file.content, "hello");
    assert.equal(file.digest, digestOf("hello"));

    // ONE walk covers the root and every component. A call per level would cost a process per
    // level of every import.
    const walks = calls.filter(
      (argv) => argv[0] === "find" && findKey(argv) === "find:stat",
    );
    assert.equal(walks.length, 1);
    assert.deepEqual(walks[0].slice(1, walks[0].indexOf("-maxdepth")), [
      abs,
      `${abs}/pdf-tools`,
      `${abs}/pdf-tools/SKILL.md`,
    ]);
  });

  it("refuses a target that resolves outside the root", async () => {
    const { reader } = daytonaReader({
      realpath: (target) =>
        target === abs || target === cwd ? target : "/etc/passwd",
    });

    await assert.rejects(
      () => reader.readImportFile("a.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_invalid");
        assert.match(error.message, /resolves outside/);
        return true;
      },
    );
  });

  it("refuses an import ROOT that resolves outside the workspace", async () => {
    // The descendant test below the root proves nothing when the root itself was moved: every
    // path under a relocated root is a faithful descendant of the attacker's directory.
    const { reader } = daytonaReader({
      realpath: (target) => (target === cwd ? cwd : "/home/user/.ssh"),
    });

    await assert.rejects(
      () => reader.readImportFile("id_rsa"),
      (error: ImportError) => {
        assert.equal(error.code, "source_invalid");
        assert.match(error.message, /resolves outside the workspace/);
        return true;
      },
    );
  });

  it("refuses an import ROOT that is a symbolic link", async () => {
    const { reader } = daytonaReader({ types: { [abs]: "l" } });

    await assert.rejects(
      () => reader.readImportFile("a.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_invalid");
        assert.match(error.message, /symbolic link/);
        return true;
      },
    );
  });

  it("refuses a symbolic link reported by %y", async () => {
    // `%y` reports the entry's own type, so a link shows as `l`. `%Y` would follow it and
    // hide the link entirely.
    const { reader } = daytonaReader({ types: { [`${abs}/link.md`]: "l" } });

    await assert.rejects(
      () => reader.readImportFile("link.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_unsupported_content");
        assert.match(error.message, /symbolic link/);
        return true;
      },
    );
  });

  it("refuses an INTERMEDIATE symbolic link whose target stays inside the root", async () => {
    // `realpath` cannot catch this one: the link resolves under the root, so the descendant test
    // passes. Only the per-component type check sees it, and the local walk refuses it, so
    // accepting it here would make the two readers disagree about the same tree.
    const { reader } = daytonaReader({ types: { [`${abs}/link`]: "l" } });

    await assert.rejects(
      () => reader.readImportFile("link/SKILL.md"),
      (error: ImportError) => {
        assert.equal(error.code, "source_unsupported_content");
        assert.match(error.message, /link is a symbolic link/);
        return true;
      },
    );
  });

  it("detects a tree deeper than the walk", async () => {
    // `-maxdepth 8` omits deeper entries silently, so the probe is what turns a silent
    // disappearance into a reported one.
    const reader = new DaytonaWorkspaceReader(cwd, async (argv) => {
      if (argv.includes("-quit")) {
        return { stdout: Buffer.from("x"), exitCode: 0 };
      }
      return { stdout: Buffer.alloc(0), exitCode: 0 };
    });
    assert.equal(await reader.hasDepthOverflow(), true);
  });

  it("reports no overflow when the probe finds nothing", async () => {
    const reader = new DaytonaWorkspaceReader(cwd, async () => ({
      stdout: Buffer.alloc(0),
      exitCode: 0,
    }));
    assert.equal(await reader.hasDepthOverflow(), false);
  });

  it("lists the root for a not-found answer", async () => {
    const reader = new DaytonaWorkspaceReader(cwd, async (argv) => {
      if (argv[0] === "find" && !argv.includes("-quit")) {
        return {
          stdout: framed([
            ["d", "755", "4096", "pdf-tools"],
            ["f", "644", "3", "notes.md"],
          ]),
          exitCode: 0,
        };
      }
      return { stdout: Buffer.alloc(0), exitCode: 1 };
    });
    assert.deepEqual(await reader.listImportRoot(), ["notes.md", "pdf-tools/"]);
  });

  it("never runs a shell", async () => {
    const { exec, calls } = fakeExec({});
    const reader = new DaytonaWorkspaceReader(cwd, exec);
    await reader.listImportRoot().catch(() => {});
    for (const argv of calls) {
      assert.ok(Array.isArray(argv), "commands are argument vectors");
      assert.ok(!["sh", "bash", "-c"].includes(argv[0]));
    }
  });
});

// ---------------------------------------------------------------------------
// Marker resolution (change-set.md 6.1, 6.5, 6.6)
// ---------------------------------------------------------------------------

function commitArgs(operations: unknown[]): Record<string, unknown> {
  return { workflow_revision: { delta: { operations } } };
}

type OperationValue = Record<string, unknown>;

/** The `value` of one operation, so the assertions read like the shape they check. */
function valueOf(args: unknown, index = 0): OperationValue {
  const shaped = args as {
    workflow_revision: {
      delta: { operations: Array<{ value: OperationValue }> };
    };
  };
  return shaped.workflow_revision.delta.operations[index].value;
}

class StubReader {
  constructor(private readonly files: Record<string, string>) {}

  async listImportRoot() {
    return Object.keys(this.files).sort();
  }

  async readImportFile(rawPath: string) {
    const resolved = resolveImportPath(rawPath, CWD);
    if (!resolved.ok) throw new ImportError("source_invalid", resolved.message);
    const content = this.files[resolved.relativePath];
    if (content === undefined) {
      throw new ImportError(
        "source_not_found",
        `${resolved.relativePath} is missing`,
        {
          available: await this.listImportRoot(),
        },
      );
    }
    return {
      relativePath: resolved.relativePath,
      content,
      bytes: Buffer.byteLength(content),
      digest: digestOf(content),
      executableBit: false,
    };
  }
}

describe("findAllMarkers", () => {
  it("finds markers at any depth, with their pointers", () => {
    const args = commitArgs([
      {
        operation: "add_item",
        value: {
          name: "pdf-tools",
          body: { "@ag.file": "a.md" },
          files: [{ path: "x.py", content: { "@ag.file": "x.py" } }],
        },
      },
    ]);
    const markers = findAllMarkers(args);
    assert.deepEqual(
      markers.map((m) => m.valuePointer),
      ["/body", "/files/0/content"],
    );
    assert.equal(markers[0].operationIndex, 0);
  });

  it("finds none when there are none", () => {
    assert.equal(
      findAllMarkers(commitArgs([{ operation: "set", value: "x" }])).length,
      0,
    );
  });

  it("ignores a legacy delta", () => {
    assert.equal(
      findAllMarkers({ workflow_revision: { delta: { set: { a: 1 } } } })
        .length,
      0,
    );
  });
});

describe("resolveFileMarkers", () => {
  it("substitutes the file text in place", async () => {
    const reader = new StubReader({ "a.md": "# Skill\n" });
    const args = commitArgs([
      {
        operation: "add_item",
        value: { name: "s", body: { "@ag.file": "a.md" } },
      },
    ]);

    const { args: next, manifest } = await resolveFileMarkers(
      args,
      reader as never,
    );
    assert.equal(valueOf(next).body, "# Skill\n");
    assert.equal(manifest.entries[0].bytes, 8);
    assert.equal(manifest.entries[0].digest, digestOf("# Skill\n"));
  });

  it("replaces a `set` operation's WHOLE value from one file", async () => {
    // The founding use case: an oversized instructions document lives in a file, and the
    // marker is the entire `value` rather than a field inside it. The pointer for that marker
    // is `/`, which cannot be written THROUGH — there is no parent inside `value` to write to —
    // so the substitution assigns `operation.value` itself.
    const reader = new StubReader({ "instructions.md": "# Agent\nBe brief.\n" });
    const args = commitArgs([
      {
        operation: "set",
        target: ["parameters", "agent", "instructions"],
        value: { "@ag.file": "instructions.md" },
      },
    ]);

    const { args: next, manifest, markers } = await resolveFileMarkers(
      args,
      reader as never,
    );

    assert.equal(valueOf(next), "# Agent\nBe brief.\n");
    assert.equal(markers[0].valuePointer, "/");
    assert.equal(manifest.entries[0].relativePath, "instructions.md");
  });

  it("does not mutate the caller's arguments", async () => {
    const reader = new StubReader({ "a.md": "text" });
    const args = commitArgs([
      { operation: "add_item", value: { body: { "@ag.file": "a.md" } } },
    ]);
    await resolveFileMarkers(args, reader as never);
    assert.deepEqual(valueOf(args).body, { "@ag.file": "a.md" });
  });

  it("resolves several markers in one commit", async () => {
    const reader = new StubReader({ "a.md": "aa", "b/x.py": "bbb" });
    const args = commitArgs([
      {
        operation: "add_item",
        value: {
          body: { "@ag.file": "a.md" },
          files: [{ content: { "@ag.file": "b/x.py" } }],
        },
      },
    ]);
    const { manifest } = await resolveFileMarkers(args, reader as never);
    assert.equal(manifest.entries.length, 2);
    assert.equal(manifest.totalBytes, 5);
  });

  it("fails the whole commit when one marker fails", async () => {
    // A commit is one atomic change, so a partially resolvable one has no meaning.
    const reader = new StubReader({ "a.md": "aa" });
    const args = commitArgs([
      {
        operation: "add_item",
        value: {
          body: { "@ag.file": "a.md" },
          files: [{ content: { "@ag.file": "missing.py" } }],
        },
      },
    ]);
    await assert.rejects(
      () => resolveFileMarkers(args, reader as never),
      (error: MarkerResolutionError) => {
        assert.equal(error.code, "source_not_found");
        assert.equal(error.valuePointer, "/files/0/content");
        return true;
      },
    );
  });

  it("substitutes nothing when a later marker fails", async () => {
    const reader = new StubReader({ "a.md": "aa" });
    const args = commitArgs([
      {
        operation: "add_item",
        value: {
          body: { "@ag.file": "a.md" },
          other: { "@ag.file": "gone.md" },
        },
      },
    ]);
    await assert.rejects(() => resolveFileMarkers(args, reader as never));
    assert.deepEqual(valueOf(args).body, { "@ag.file": "a.md" });
  });

  it("names the next step and what exists on a miss", async () => {
    const reader = new StubReader({ "notes.md": "x" });
    const args = commitArgs([
      { operation: "set", value: { "@ag.file": "typo.md" } },
    ]);
    await assert.rejects(
      () => resolveFileMarkers(args, reader as never),
      (error: MarkerResolutionError) => {
        const detail = error.toDetail();
        assert.match(String(detail.next_step), /\.agenta-imports/);
        assert.deepEqual(detail.available, ["notes.md"]);
        assert.equal(detail.retryable, true);
        return true;
      },
    );
  });

  it("refuses a marker with no path", async () => {
    const reader = new StubReader({});
    const args = commitArgs([{ operation: "set", value: { "@ag.file": "" } }]);
    await assert.rejects(
      () => resolveFileMarkers(args, reader as never),
      (error: MarkerResolutionError) => {
        assert.equal(error.code, "source_invalid");
        return true;
      },
    );
  });

  it("leaves an argument set with no markers untouched", async () => {
    const reader = new StubReader({});
    const args = commitArgs([{ operation: "set", value: "plain" }]);
    const { args: next, manifest } = await resolveFileMarkers(
      args,
      reader as never,
    );
    assert.equal(next, args);
    assert.equal(manifest.entries.length, 0);
  });
});
