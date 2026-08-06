/**
 * The approval manifest the card renders (slice S3b).
 *
 * Contract: docs/design/agent-config-editing/contracts/workspace-import.md 8.
 *
 * One rule governs this whole module, and it is the reason it exists:
 * **the card never shows only a byte count and a path.** A human approves a readable change,
 * or the runner does not ask. So every `@ag.file` marker in a commit contributes its path,
 * size, digest, and executable bit, and a `set` that replaces a whole field from one file
 * additionally contributes a unified diff against the text it replaces.
 *
 * The manifest is computed ONCE, at mint time, from the same bytes the authorization freezes.
 * It is not recomputed at execution, and the card is never rebuilt from a second read.
 */
import type { ImportManifest } from "./file-markers.ts";
import { unifiedDiff } from "./text-diff.ts";

/** One resolved `@ag.file` marker, as the card lists it. */
export interface ManifestFileEntry {
  operationIndex: number;
  valuePointer: string;
  /** The path the agent wrote. */
  requestedPath: string;
  /** The path below the import root, after normalization. */
  relativePath: string;
  bytes: number;
  digest: string;
  /** Observed on disk. The STORED `executable` field is the agent's own, and the card shows
   *  that one separately — they are different things (workspace-import.md 5.2). */
  executableBit: boolean;
}

/**
 * The single-text presentation: a `set` whose entire value came from one file.
 *
 * The diff is the substance. The sizes, counts, and digests support it; they never replace it.
 */
export interface ManifestDiffEntry {
  operationIndex: number;
  /** A readable name for the field, e.g. `instructions / agents_md`. */
  targetField: string;
  /** The structured target from the operation. */
  target: unknown[];
  /** The revision the old side was fetched at. Always present: an approval means "this exact
   *  old text becomes this exact new text ON THIS EXACT BASE". */
  baseRevisionId: string;
  oldBytes: number;
  oldLines: number;
  oldDigest: string;
  newBytes: number;
  newLines: number;
  newDigest: string;
  /** Unified diff, capped for display. */
  diff: string;
  addedLines: number;
  removedLines: number;
  /** True when `diff` was cut at the display cap. The counts and digests stay exact. */
  diffTruncated: boolean;
  /** True when the alignment degraded to a whole-block replacement on a very large change. */
  diffCoarse: boolean;
}

export interface ApprovalManifest {
  version: 1;
  files: ManifestFileEntry[];
  totalBytes: number;
  diffs: ManifestDiffEntry[];
  catalogGeneration: string;
  /**
   * Over the FULLY resolved arguments, including every file's bytes.
   *
   * The card must say, in words the human reads, that this covers the full value and not the
   * truncated view. Without that sentence a truncated card implies a partial approval.
   */
  contentDigest: string;
}

/** Display cap for the unified diff (workspace-import.md 8.4.4). */
export const MAX_DIFF_LINES = 400;

function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/**
 * A readable name for a target path.
 *
 * The leading `parameters` / `agent` segments are addressing scaffolding the human does not
 * need; what they need is the field. A selector segment renders as its key, so a skill body
 * reads `skills pdf-tools / body` rather than a JSON blob.
 */
export function readableTarget(target: unknown[]): string {
  const parts: string[] = [];
  for (const segment of target) {
    if (typeof segment === "string") {
      if (
        parts.length === 0 &&
        (segment === "parameters" || segment === "agent")
      ) {
        continue;
      }
      parts.push(segment);
      continue;
    }
    if (segment && typeof segment === "object") {
      const record = segment as Record<string, unknown>;
      // The selector key was renamed `list` (the spike measured zero misuse of it); `field` is
      // the older name the wrapper still forgives, so read both.
      const list = record.list ?? record.field;
      const key = record.key ?? record.name;
      parts.push(
        [list, key].filter((part) => typeof part === "string").join(" ") ||
          "item",
      );
    }
  }
  return parts.join(" / ") || "configuration";
}

export interface DiffSource {
  operationIndex: number;
  target: unknown[];
  baseRevisionId: string;
  oldText: string;
  oldDigest: string;
  newText: string;
  newDigest: string;
}

export function buildDiffEntry(source: DiffSource): ManifestDiffEntry {
  const diff = unifiedDiff(source.oldText, source.newText, {
    maxLines: MAX_DIFF_LINES,
  });
  return {
    operationIndex: source.operationIndex,
    targetField: readableTarget(source.target),
    target: source.target,
    baseRevisionId: source.baseRevisionId,
    oldBytes: Buffer.byteLength(source.oldText, "utf8"),
    oldLines: countLines(source.oldText),
    oldDigest: source.oldDigest,
    newBytes: Buffer.byteLength(source.newText, "utf8"),
    newLines: countLines(source.newText),
    newDigest: source.newDigest,
    diff: diff.text,
    addedLines: diff.addedLines,
    removedLines: diff.removedLines,
    diffTruncated: diff.truncated,
    diffCoarse: diff.coarse,
  };
}

export function buildApprovalManifest(input: {
  imports: ImportManifest;
  diffs: ManifestDiffEntry[];
  catalogGeneration: string;
  contentDigest: string;
}): ApprovalManifest {
  return {
    version: 1,
    files: input.imports.entries.map((entry) => ({ ...entry })),
    totalBytes: input.imports.totalBytes,
    diffs: input.diffs,
    catalogGeneration: input.catalogGeneration,
    contentDigest: input.contentDigest,
  };
}
