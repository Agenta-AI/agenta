/**
 * Reading one file out of the workspace import root (agent-config-editing, slice S3a).
 *
 * Contract: docs/design/agent-config-editing/contracts/workspace-import.md sections 3 and 6.
 * Since the `@ag.file` consolidation each read is ONE FILE, not a folder tree, so the codec
 * is gone; the confinement, the symbolic-link refusal, the caps, and the digests stay.
 *
 * Two implementations, because the two platforms give different guarantees:
 *
 * - `LocalWorkspaceReader` does the descriptor-relative walk section 3.4 REQUIRES. A
 *   descriptor names an inode, not a path, so replacing a directory after the runner holds
 *   its handle cannot redirect the read.
 * - `DaytonaWorkspaceReader` cannot hold descriptors across the daemon interface, so it uses
 *   the one-shot NUL-framed manifest of section 6.2 and accepts the residual window section
 *   6.5 states plainly.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { posix as path } from "node:path";

import {
  IMPORT_ROOT,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  importRootFor,
  isResolvedDescendant,
  resolveImportPath,
} from "./import-paths.ts";

export type ImportFailureCode =
  | "source_not_found"
  | "source_invalid"
  | "source_too_large"
  | "source_unsupported_content";

export class ImportError extends Error {
  readonly code: ImportFailureCode;
  /** Folders that DO exist under the root; a wrong path is nearly always a near miss. */
  readonly available?: string[];

  constructor(
    code: ImportFailureCode,
    message: string,
    options?: { available?: string[] },
  ) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.available = options?.available;
  }
}

export interface ImportedFile {
  /** The path below the import root, for the manifest and the card. */
  relativePath: string;
  content: string;
  bytes: number;
  /** SHA-256 over the exact bytes that will be committed. Contract 7.1. */
  digest: string;
  /** Observed, never a grant. Contract 5.3: the runner never derives policy from it. */
  executableBit: boolean;
}

export interface WorkspaceReader {
  /** Read one file, confined to the import root. */
  readImportFile(rawPath: string): Promise<ImportedFile>;
  /** Top-level names under the import root, for a `source_not_found` answer. */
  listImportRoot(): Promise<string[]>;
}

export function digestOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertUtf8Text(buffer: Buffer, relativePath: string): string {
  // A fatal decoder refuses the malformed sequence itself. Testing the DECODED text for U+FFFD
  // cannot: a file may legitimately contain that character, and exempting every buffer holding
  // its first byte (0xEF) lets any invalid sequence carrying an 0xEF through as mojibake.
  //
  // `ignoreBOM` keeps a leading BOM as a character. The default strips it, which would make the
  // committed content differ from the bytes on disk and desynchronize `bytes` from `digest`.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    throw new ImportError(
      "source_unsupported_content",
      `${relativePath} is not valid UTF-8 text.`,
    );
  }
  if (buffer.includes(0)) {
    throw new ImportError(
      "source_unsupported_content",
      `${relativePath} holds a NUL byte, so it is not text.`,
    );
  }
  return text;
}

function assertSize(bytes: number, relativePath: string): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new ImportError(
      "source_too_large",
      `${relativePath} is ${bytes} bytes; the limit is ${MAX_FILE_BYTES}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Local: the descriptor-relative walk (contract 3.2, 3.4)
// ---------------------------------------------------------------------------

/**
 * Open `name` relative to an already-open directory handle.
 *
 * Node exposes no `openat`, but `/proc/self/fd/<fd>` names the directory the descriptor
 * points at, so opening `<that>/<name>` resolves `name` against the INODE we hold rather
 * than against a path that may have been replaced. Combined with `O_NOFOLLOW` on each
 * component, this gives the property section 3.2 requires without a native helper.
 *
 * `name` is a single component, never a path: the caller walks one level at a time, so an
 * attacker never gets a multi-component lookup to redirect.
 */
async function openAt(
  parent: FileHandle,
  name: string,
  flags: number,
): Promise<FileHandle> {
  if (name.includes("/")) {
    throw new ImportError(
      "source_invalid",
      "internal: openAt takes one component",
    );
  }
  return fs.open(`/proc/self/fd/${parent.fd}/${name}`, flags);
}

export class LocalWorkspaceReader implements WorkspaceReader {
  constructor(private readonly workspaceCwd: string) {}

  private rootPath(): string {
    return importRootFor(this.workspaceCwd);
  }

  async listImportRoot(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.rootPath(), {
        withFileTypes: true,
      });
      return entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
    } catch {
      return [];
    }
  }

  async readImportFile(rawPath: string): Promise<ImportedFile> {
    const resolved = resolveImportPath(rawPath, this.workspaceCwd);
    if (!resolved.ok) {
      throw new ImportError("source_invalid", resolved.message);
    }

    let dir: FileHandle | undefined;
    let file: FileHandle | undefined;
    try {
      try {
        // O_NOFOLLOW on the ROOT, not only on the components below it. Without it a symbolic
        // link in place of `.agenta-imports` is followed before the walk starts, and every
        // descriptor-relative open below is then correctly confined to the link's target rather
        // than to the workspace (contract 3.2 step 1).
        dir = await fs.open(
          this.rootPath(),
          fsConstants.O_RDONLY |
            fsConstants.O_DIRECTORY |
            fsConstants.O_NOFOLLOW,
        );
      } catch (error) {
        throw await this.describeRootFailure(error);
      }

      // Verify the root itself before trusting anything below it.
      const rootStat = await dir.stat();
      if (!rootStat.isDirectory()) {
        throw new ImportError(
          "source_invalid",
          `${IMPORT_ROOT} is not a directory.`,
        );
      }

      const segments = resolved.segments;
      for (let index = 0; index < segments.length - 1; index += 1) {
        if (index >= MAX_DEPTH) {
          throw new ImportError(
            "source_unsupported_content",
            `the path is deeper than ${MAX_DEPTH} levels.`,
          );
        }
        const next = await this.openDirAt(
          dir,
          segments[index],
          resolved.relativePath,
        );
        await dir.close();
        dir = next;
      }

      const name = segments[segments.length - 1];
      try {
        // O_NOFOLLOW on the final component: a symbolic link is refused, never followed
        // (contract 3.5). The intermediate components are already safe because each was
        // opened relative to the previous descriptor.
        file = await openAt(
          dir,
          name,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
      } catch (error) {
        throw await this.describeOpenFailure(error, resolved.relativePath);
      }

      // Type, size, and mode come from the HANDLE, never from a path.
      const stat = await file.stat();
      if (stat.isDirectory()) {
        throw new ImportError(
          "source_invalid",
          `${resolved.relativePath} is a directory; name one file.`,
        );
      }
      if (!stat.isFile()) {
        throw new ImportError(
          "source_unsupported_content",
          `${resolved.relativePath} is not a regular file.`,
        );
      }
      assertSize(stat.size, resolved.relativePath);

      const buffer = await file.readFile();
      assertSize(buffer.byteLength, resolved.relativePath);
      const content = assertUtf8Text(buffer, resolved.relativePath);

      return {
        relativePath: resolved.relativePath,
        content,
        bytes: buffer.byteLength,
        digest: digestOf(content),
        executableBit: (stat.mode & 0o111) !== 0,
      };
    } finally {
      await file?.close().catch(() => {});
      await dir?.close().catch(() => {});
    }
  }

  private async openDirAt(
    parent: FileHandle,
    name: string,
    relativePath: string,
  ): Promise<FileHandle> {
    try {
      return await openAt(
        parent,
        name,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      // With O_DIRECTORY and O_NOFOLLOW together, Linux reports a symbolic link as
      // ENOTDIR on some kernels and ELOOP on others. Both mean the component was
      // refused, not followed, so the security property holds either way — but the
      // message must be right. Re-open WITHOUT O_DIRECTORY, still relative to the same
      // descriptor: ELOOP then means a link, success means an ordinary file. This costs
      // one syscall on the error path and never performs a new path lookup.
      if (code === "ENOTDIR" || code === "ELOOP") {
        const kind = await this.classifyRefusedComponent(parent, name);
        throw new ImportError(
          "source_unsupported_content",
          kind === "symlink"
            ? `${name} is a symbolic link; links are not imported.`
            : `${relativePath}: '${name}' is not a directory.`,
        );
      }
      throw await this.describeOpenFailure(error, relativePath, name);
    }
  }

  /**
   * Why the root open failed, as a code the caller can act on.
   *
   * With `O_DIRECTORY` and `O_NOFOLLOW` together Linux reports a symbolic link as `ENOTDIR` on
   * some kernels and `ELOOP` on others, so the errno alone cannot tell a link from a plain file.
   * `lstat` names the entry itself. It runs only on the error path and only to pick the answer;
   * nothing is opened through it.
   */
  private async describeRootFailure(error: unknown): Promise<ImportError> {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ELOOP" || code === "ENOTDIR") {
      let isLink = code === "ELOOP";
      if (!isLink) {
        try {
          isLink = (await fs.lstat(this.rootPath())).isSymbolicLink();
        } catch {
          // The root went away between the open and the classification; the answer stays
          // "not a directory", which is true either way.
        }
      }
      return new ImportError(
        "source_invalid",
        isLink
          ? `${IMPORT_ROOT} is a symbolic link; links are not imported.`
          : `${IMPORT_ROOT} is not a directory.`,
      );
    }
    return new ImportError(
      "source_not_found",
      `${IMPORT_ROOT}/ does not exist in this workspace.`,
      { available: [] },
    );
  }

  private async classifyRefusedComponent(
    parent: FileHandle,
    name: string,
  ): Promise<"symlink" | "not-a-directory"> {
    let handle: FileHandle | undefined;
    try {
      handle = await openAt(
        parent,
        name,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      return "not-a-directory";
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === "ELOOP"
        ? "symlink"
        : "not-a-directory";
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  private async describeOpenFailure(
    error: unknown,
    relativePath: string,
    component?: string,
  ): Promise<ImportError> {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ELOOP") {
      // O_NOFOLLOW reports ELOOP for a symbolic link. Refused, not followed.
      return new ImportError(
        "source_unsupported_content",
        `${component ?? relativePath} is a symbolic link; links are not imported.`,
      );
    }
    if (code === "ENOTDIR") {
      return new ImportError(
        "source_invalid",
        `${relativePath}: a parent segment is not a directory.`,
      );
    }
    return new ImportError(
      "source_not_found",
      `${relativePath} does not exist under ${IMPORT_ROOT}/.`,
      { available: await this.listImportRoot() },
    );
  }
}

// ---------------------------------------------------------------------------
// Daytona: the one-shot NUL-framed manifest (contract 6.2)
// ---------------------------------------------------------------------------

export interface DaytonaExec {
  /** Run one argv, never a shell. Returns stdout as raw bytes. */
  (argv: string[]): Promise<{ stdout: Buffer; exitCode: number }>;
}

export interface ManifestEntry {
  type: string;
  mode: string;
  size: number;
  relativePath: string;
}

/**
 * Parse `find -printf '%y\0%m\0%s\0%P\0'`.
 *
 * NUL is the only safe separator: a file name may hold a newline, a tab, a quote, or a
 * backslash, but never a NUL. The prototype's tab-and-newline framing was not safe.
 */
export function parseManifest(stdout: Buffer): ManifestEntry[] {
  const fields = stdout.toString("utf8").split("\0");
  const entries: ManifestEntry[] = [];
  // The trailing NUL yields one empty tail field, so stop before a short final record.
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [type, mode, size, relativePath] = fields.slice(index, index + 4);
    if (type === "" && mode === "" && size === "" && relativePath === "")
      continue;
    entries.push({
      type,
      mode,
      size: Number.parseInt(size, 10) || 0,
      relativePath,
    });
  }
  return entries;
}

export class DaytonaWorkspaceReader implements WorkspaceReader {
  constructor(
    private readonly workspaceCwd: string,
    private readonly exec: DaytonaExec,
  ) {}

  private rootPath(): string {
    return importRootFor(this.workspaceCwd);
  }

  async listImportRoot(): Promise<string[]> {
    const result = await this.exec([
      "find",
      this.rootPath(),
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-printf",
      "%y\0%m\0%s\0%P\0",
    ]);
    if (result.exitCode !== 0) return [];
    return parseManifest(result.stdout)
      .map((entry) =>
        entry.type === "d" ? `${entry.relativePath}/` : entry.relativePath,
      )
      .sort();
  }

  /** Contract 6.2: any output means the tree goes deeper than the walk. */
  async hasDepthOverflow(): Promise<boolean> {
    const result = await this.exec([
      "find",
      this.rootPath(),
      "-mindepth",
      String(MAX_DEPTH + 1),
      "-printf",
      "x",
      "-quit",
    ]);
    return result.exitCode === 0 && result.stdout.length > 0;
  }

  async readImportFile(rawPath: string): Promise<ImportedFile> {
    const resolved = resolveImportPath(rawPath, this.workspaceCwd);
    if (!resolved.ok) {
      throw new ImportError("source_invalid", resolved.message);
    }

    const root = this.rootPath();
    const absTarget = path.join(root, resolved.relativePath);

    // The descendant test runs on RESOLVED paths: comparing unresolved ones is what the
    // symbolic-link check exists to defeat. The ROOT is resolved against the workspace for the
    // same reason: a root that is itself a link anchors every check below it to the link's
    // target, so "under the root" would stop meaning "inside the workspace".
    const [resolvedWorkspace, resolvedRoot, resolvedTarget] = await Promise.all([
      this.realpath(this.workspaceCwd),
      this.realpath(root),
      this.realpath(absTarget),
    ]);
    if (resolvedTarget === null) {
      throw new ImportError(
        "source_not_found",
        `${resolved.relativePath} does not exist under ${IMPORT_ROOT}/.`,
        { available: await this.listImportRoot() },
      );
    }
    if (resolvedRoot === null || resolvedWorkspace === null) {
      throw new ImportError(
        "source_not_found",
        `${IMPORT_ROOT}/ does not exist in this workspace.`,
        { available: [] },
      );
    }
    if (!isResolvedDescendant(resolvedRoot, resolvedWorkspace)) {
      throw new ImportError(
        "source_invalid",
        `${IMPORT_ROOT}/ resolves outside the workspace.`,
      );
    }
    if (!isResolvedDescendant(resolvedTarget, resolvedRoot)) {
      throw new ImportError(
        "source_invalid",
        `${resolved.relativePath} resolves outside ${IMPORT_ROOT}/.`,
      );
    }

    // ONE execution covers the whole path: the root, every intermediate directory, and the file.
    // `%y` reports each entry's OWN type, so a link ANYWHERE on the path reports `l` and is
    // refused rather than followed (contract 3.5, and 6.2 rule 2). Checking only the final entry
    // would accept an intermediate link, which the local walk refuses; `realpath` alone catches
    // only the links that leave the root.
    const prefixes = resolved.segments.map((_, index) =>
      path.join(root, ...resolved.segments.slice(0, index + 1)),
    );
    const walked = await this.statChain([root, ...prefixes]);
    if (walked === null || walked.length !== prefixes.length + 1) {
      throw new ImportError(
        "source_not_found",
        `${resolved.relativePath} does not exist under ${IMPORT_ROOT}/.`,
        { available: await this.listImportRoot() },
      );
    }

    const [rootEntry, ...entries] = walked;
    if (rootEntry.type === "l") {
      throw new ImportError(
        "source_invalid",
        `${IMPORT_ROOT} is a symbolic link; links are not imported.`,
      );
    }
    if (rootEntry.type !== "d") {
      throw new ImportError(
        "source_invalid",
        `${IMPORT_ROOT} is not a directory.`,
      );
    }
    for (let index = 0; index < entries.length - 1; index += 1) {
      const segment = resolved.segments[index];
      if (entries[index].type === "l") {
        throw new ImportError(
          "source_unsupported_content",
          `${segment} is a symbolic link; links are not imported.`,
        );
      }
      if (entries[index].type !== "d") {
        throw new ImportError(
          "source_invalid",
          `${resolved.relativePath}: '${segment}' is not a directory.`,
        );
      }
    }

    const stat = entries[entries.length - 1];
    if (stat.type === "l") {
      throw new ImportError(
        "source_unsupported_content",
        `${resolved.relativePath} is a symbolic link; links are not imported.`,
      );
    }
    if (stat.type === "d") {
      throw new ImportError(
        "source_invalid",
        `${resolved.relativePath} is a directory; name one file.`,
      );
    }
    if (stat.type !== "f") {
      throw new ImportError(
        "source_unsupported_content",
        `${resolved.relativePath} is not a regular file.`,
      );
    }
    assertSize(stat.size, resolved.relativePath);

    const result = await this.exec(["cat", "--", absTarget]);
    if (result.exitCode !== 0) {
      throw new ImportError(
        "source_not_found",
        `${resolved.relativePath} could not be read.`,
        { available: await this.listImportRoot() },
      );
    }
    assertSize(result.stdout.byteLength, resolved.relativePath);
    const content = assertUtf8Text(result.stdout, resolved.relativePath);

    return {
      relativePath: resolved.relativePath,
      content,
      bytes: result.stdout.byteLength,
      digest: digestOf(content),
      executableBit: /[1357]/.test(stat.mode.slice(-3)),
    };
  }

  private async realpath(target: string): Promise<string | null> {
    const result = await this.exec(["realpath", "--", target]);
    if (result.exitCode !== 0) return null;
    const value = result.stdout.toString("utf8").trim();
    return value === "" ? null : value;
  }

  /**
   * The own-type of every path in `paths`, in one execution.
   *
   * `find` takes many starting points, reports them in argument order, and prints an empty `%P`
   * for a starting point itself, so the records line up with the paths positionally. One call per
   * component would cost one process per level of every import.
   */
  private async statChain(paths: string[]): Promise<ManifestEntry[] | null> {
    const result = await this.exec([
      "find",
      ...paths,
      "-maxdepth",
      "0",
      "-printf",
      "%y\0%m\0%s\0%P\0",
    ]);
    if (result.exitCode !== 0) return null;
    return parseManifest(result.stdout);
  }
}
