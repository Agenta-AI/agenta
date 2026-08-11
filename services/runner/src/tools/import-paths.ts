/**
 * Path rules for the workspace import root (agent-config-editing, slice S3a).
 *
 * Contract: docs/design/agent-config-editing/contracts/workspace-import.md sections 2 and
 * 3.1, with the path FORM taken from change-set.md section 6.3 (the consolidation row:
 * "relative to the workspace root, or absolute inside the workspace; the runner normalizes
 * both"). workspace-import.md 3.1 still says "rejects an absolute path"; that line predates
 * the ruling and the banner at the top of that file supersedes it.
 *
 * Everything here is lexical and pure. It runs BEFORE any filesystem access, so a path that
 * cannot possibly be legal never reaches the reader. The real-path and descriptor checks in
 * workspace-reader.ts are the other half; neither is sufficient alone.
 */
import { posix as path } from "node:path";

/** The designated import root, relative to the run's workspace cwd. */
export const IMPORT_ROOT = ".agenta-imports";

/** Contract 3.1. Long enough for any real tree, short enough to bound the walk. */
export const MAX_PATH_BYTES = 1024;

/** Contract 4.4. Matches `SkillFile.content` so a runner-side success cannot become a
 *  server-side validation failure. */
export const MAX_FILE_BYTES = 200_000;

/** Contract 4.4, read per commit rather than per folder now that a marker is one file. */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/** Contract 4.4. The walk stops here, and stopping is reported, never silent. */
export const MAX_DEPTH = 8;

/** Contract 4.4. */
export const MAX_RELATIVE_PATH_CHARS = 255;

export type ImportPathRejection =
  | "path_empty"
  | "path_too_long"
  | "path_traversal"
  | "path_backslash"
  | "path_nul"
  | "path_outside_workspace"
  | "path_outside_import_root"
  | "path_is_root"
  | "path_too_deep";

export interface ImportPathOk {
  ok: true;
  /** Components below the import root, already checked. Walk these one at a time. */
  segments: string[];
  /** The same path as text, for manifests and errors. Never used to open anything. */
  relativePath: string;
}

export interface ImportPathError {
  ok: false;
  reason: ImportPathRejection;
  message: string;
}

export type ImportPathResult = ImportPathOk | ImportPathError;

const reject = (
  reason: ImportPathRejection,
  message: string,
): ImportPathError => ({ ok: false, reason, message });

/**
 * Normalize and confine one `@ag.file` path, lexically.
 *
 * Accepts either form the agent may write:
 *   - relative to the workspace root:  `.agenta-imports/pdf-tools/SKILL.md`
 *   - relative to the import root:     `pdf-tools/SKILL.md`
 *   - absolute inside the workspace:   `/workspace/.agenta-imports/pdf-tools/SKILL.md`
 *
 * Rejecting absolute paths would fight the model, which writes them naturally; the ruling
 * is to normalize instead and refuse only what leaves the workspace.
 */
export function resolveImportPath(
  rawPath: string,
  workspaceCwd: string,
): ImportPathResult {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return reject("path_empty", "the path is empty");
  }
  // NUL first: it terminates a C string, so a check on the JS string can pass while the
  // syscall sees a shorter path.
  if (rawPath.includes("\0")) {
    return reject("path_nul", "the path holds a NUL byte");
  }
  if (Buffer.byteLength(rawPath, "utf8") > MAX_PATH_BYTES) {
    return reject(
      "path_too_long",
      `the path is longer than ${MAX_PATH_BYTES} bytes`,
    );
  }
  // A backslash is a separator on some platforms and a literal on others; refusing it
  // keeps one meaning everywhere.
  if (rawPath.includes("\\")) {
    return reject("path_backslash", "the path holds a backslash");
  }

  let candidate = rawPath;

  // An absolute path is legal only inside the workspace, and it is normalized to a
  // workspace-relative one before any other rule applies.
  if (path.isAbsolute(candidate)) {
    const root = ensureTrailingSlash(path.normalize(workspaceCwd));
    const normalized = path.normalize(candidate);
    if (
      normalized !== path.normalize(workspaceCwd) &&
      !normalized.startsWith(root)
    ) {
      return reject(
        "path_outside_workspace",
        "an absolute path must sit inside the workspace",
      );
    }
    candidate = path.relative(path.normalize(workspaceCwd), normalized);
  }

  // `..` is checked on the RAW segments, not after normalization: normalizing first would
  // silently collapse `a/../../b` into an escape that no longer looks like one.
  if (candidate.split("/").some((segment) => segment === "..")) {
    return reject("path_traversal", "the path holds a '..' segment");
  }

  // Both spellings reach the same place; the import root is implied when it is absent.
  const withinRoot = stripImportRoot(candidate);
  if (withinRoot === null) {
    return reject(
      "path_outside_import_root",
      `the path must sit under ${IMPORT_ROOT}/`,
    );
  }

  const segments = withinRoot.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) {
    return reject(
      "path_is_root",
      `${IMPORT_ROOT}/ is the root; name a file inside it`,
    );
  }
  if (segments.length > MAX_DEPTH) {
    return reject(
      "path_too_deep",
      `the path is deeper than ${MAX_DEPTH} levels`,
    );
  }

  const relativePath = segments.join("/");
  if ([...relativePath].length > MAX_RELATIVE_PATH_CHARS) {
    return reject(
      "path_too_long",
      `the path below the root is longer than ${MAX_RELATIVE_PATH_CHARS} characters`,
    );
  }

  return { ok: true, segments, relativePath };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * Drop a leading `.agenta-imports/` when the caller wrote one. Returns null when the path
 * names a DIFFERENT top-level folder, which is the "outside the root" case.
 */
function stripImportRoot(candidate: string): string | null {
  const normalized = candidate.replace(/^\.\//, "");
  if (normalized === IMPORT_ROOT) return "";
  if (normalized.startsWith(`${IMPORT_ROOT}/`)) {
    return normalized.slice(IMPORT_ROOT.length + 1);
  }
  // No root prefix: the path is already relative to the root. A path that starts with a
  // different dot-folder is still just a name inside the root, so it stays legal here and
  // the real-path check decides.
  return normalized;
}

/** The absolute import root for a workspace. Used to open the root descriptor once. */
export function importRootFor(workspaceCwd: string): string {
  return path.join(path.normalize(workspaceCwd), IMPORT_ROOT);
}

/**
 * Contract 6.2: the descendant test, on RESOLVED paths only.
 *
 * `F` passes when it equals `R` or starts with `R` plus a separator. Comparing unresolved
 * paths is exactly what the symbolic-link check exists to defeat, so callers must pass
 * realpath output.
 */
export function isResolvedDescendant(
  resolvedTarget: string,
  resolvedRoot: string,
): boolean {
  const target = path.normalize(resolvedTarget);
  const root = path.normalize(resolvedRoot);
  return target === root || target.startsWith(ensureTrailingSlash(root));
}
