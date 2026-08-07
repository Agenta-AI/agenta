/**
 * A bounded unified-line diff for the approval card (slice S3b).
 *
 * Contract: docs/design/agent-config-editing/contracts/workspace-import.md 8.4.
 *
 * The diff is the SUBSTANCE of a single-text approval card: the human approves "this exact old
 * text becomes this exact new text". So this runs on the runner, over the exact two strings the
 * authorization digests bind, and the card renders what it produces.
 *
 * No diff dependency is added for it. The runner is a standalone package whose image ships to
 * every sandbox host; a line diff is a hundred lines of well-understood code, and pulling a
 * package in for one card is the worse trade.
 *
 * Bounded on purpose. An imported file may be 200 KB, and a full O(n*m) table over two
 * thousand-line texts is tens of millions of cells on the turn's hot path. Common prefix and
 * suffix are trimmed first (which is the ordinary case: a few edited lines inside a large
 * document), and a middle that is still too large degrades to a whole-block replacement rather
 * than spending the turn's budget. The counts and digests stay exact either way, and the card
 * states that the digest covers the full text.
 */

/** Beyond this many differing lines on either side, the middle is reported as one replaced
 *  block instead of a line-by-line alignment. */
const MAX_ALIGNED_LINES = 2000;

export interface UnifiedDiff {
  /** Unified-diff text: ` `, `-`, `+` prefixed lines with `@@` hunk headers. */
  text: string;
  addedLines: number;
  removedLines: number;
  /** True when the alignment degraded to a whole-block replacement (see MAX_ALIGNED_LINES). */
  coarse: boolean;
  /** True when `text` was cut at the display cap. Counts above stay exact. */
  truncated: boolean;
}

type Op = { kind: "equal" | "add" | "remove"; line: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline yields a final empty element that is not a line of content.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Longest-common-subsequence alignment of the two middles. Only ever called on inputs already
 * bounded by MAX_ALIGNED_LINES, so the table is at most 2000 x 2000.
 */
function alignLcs(oldLines: string[], newLines: string[]): Op[] {
  const rows = oldLines.length;
  const columns = newLines.length;
  // lengths[i][j] = LCS length of oldLines[i:] and newLines[j:].
  const lengths: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: "equal", line: oldLines[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ kind: "remove", line: oldLines[i] });
      i += 1;
    } else {
      ops.push({ kind: "add", line: newLines[j] });
      j += 1;
    }
  }
  for (; i < rows; i += 1) ops.push({ kind: "remove", line: oldLines[i] });
  for (; j < columns; j += 1) ops.push({ kind: "add", line: newLines[j] });
  return ops;
}

function diffOps(
  oldLines: string[],
  newLines: string[],
): {
  ops: Op[];
  coarse: boolean;
} {
  // Trim the common prefix and suffix first. This is what keeps an ordinary edit inside a large
  // instructions document cheap: only the changed region reaches the table.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);

  const head: Op[] = oldLines
    .slice(0, prefix)
    .map((line) => ({ kind: "equal" as const, line }));
  const tail: Op[] = oldLines
    .slice(oldLines.length - suffix)
    .map((line) => ({ kind: "equal" as const, line }));

  const coarse =
    oldMiddle.length > MAX_ALIGNED_LINES ||
    newMiddle.length > MAX_ALIGNED_LINES;
  const middle: Op[] = coarse
    ? [
        ...oldMiddle.map((line) => ({ kind: "remove" as const, line })),
        ...newMiddle.map((line) => ({ kind: "add" as const, line })),
      ]
    : alignLcs(oldMiddle, newMiddle);

  return { ops: [...head, ...middle, ...tail], coarse };
}

/** Group the ops into hunks with `context` equal lines around each change. */
function renderHunks(ops: Op[], context: number): string[] {
  const changed = ops
    .map((op, index) => (op.kind === "equal" ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const lines: string[] = [];
  for (const range of ranges) {
    // Line numbers are 1-based and count only the lines each side actually has.
    let oldStart = 1;
    let newStart = 1;
    for (let index = 0; index < range.start; index += 1) {
      if (ops[index].kind !== "add") oldStart += 1;
      if (ops[index].kind !== "remove") newStart += 1;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let index = range.start; index <= range.end; index += 1) {
      if (ops[index].kind !== "add") oldCount += 1;
      if (ops[index].kind !== "remove") newCount += 1;
    }
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let index = range.start; index <= range.end; index += 1) {
      const op = ops[index];
      lines.push(
        `${op.kind === "add" ? "+" : op.kind === "remove" ? "-" : " "}${op.line}`,
      );
    }
  }
  return lines;
}

/**
 * A unified diff of `oldText` against `newText`, capped at `maxLines` rendered lines.
 *
 * The cap is a DISPLAY cap only: `addedLines` and `removedLines` are counted over the whole
 * diff, and the card states that the content digest covers the full text. A truncated card that
 * implied a partial approval would be the one thing this mode exists to prevent.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  options: { maxLines?: number; context?: number } = {},
): UnifiedDiff {
  const maxLines = options.maxLines ?? 400;
  const context = options.context ?? 3;

  const { ops, coarse } = diffOps(splitLines(oldText), splitLines(newText));
  const addedLines = ops.filter((op) => op.kind === "add").length;
  const removedLines = ops.filter((op) => op.kind === "remove").length;

  const rendered = renderHunks(ops, context);
  const truncated = rendered.length > maxLines;

  return {
    text: (truncated ? rendered.slice(0, maxLines) : rendered).join("\n"),
    addedLines,
    removedLines,
    coarse,
    truncated,
  };
}
