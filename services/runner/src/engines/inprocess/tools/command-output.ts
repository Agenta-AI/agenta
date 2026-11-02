/**
 * A command's output as the `bash` tool reports it: the tail the model sees, truncated exactly as
 * Pi's own shell tool truncates (same limits, same notices). The full output is not kept here: it
 * is the command's output file in the sandbox, where the model's next command can read it.
 *
 * Bounds: the rolling tail (twice Pi's byte limit, trimmed at twice that). The command runner
 * hands over at most one bounded chunk at a time and says how many bytes it skipped when the
 * command wrote faster than it reads; once the command ended it reports the file's exact totals,
 * which replace the counts made from what was read.
 */
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail, type TruncationResult } from "@earendil-works/pi-coding-agent";
import type { OutputSink, OutputTotals } from "../sandbox/remote-command.ts";

export interface OutputSnapshot {
  text: string;
  truncation: TruncationResult | undefined;
}

export class CommandOutput implements OutputSink {
  private decoder = new TextDecoder();
  private tail = "";
  private tailBytes = 0;
  private tailStartsAtLineBoundary = true;
  private totalBytes = 0;
  private completedLines = 0;
  private currentLineBytes = 0;
  private openLine = false;
  private readonly rollingBytes = DEFAULT_MAX_BYTES * 2;

  private get totalLines(): number {
    return this.completedLines + (this.openLine ? 1 : 0);
  }

  get truncated(): boolean {
    return this.totalLines > DEFAULT_MAX_LINES || this.totalBytes > DEFAULT_MAX_BYTES;
  }

  /** Bytes this object holds in memory right now (for per-session accounting). */
  get bufferedBytes(): number {
    return this.tailBytes;
  }

  append(data: Buffer): void {
    this.addText(this.decoder.decode(data, { stream: true }));
  }

  /** Bytes the runner did not read: what came before them no longer joins what comes after. */
  skip(bytes: number): void {
    this.decoder = new TextDecoder();
    this.totalBytes += bytes;
    this.tail = "";
    this.tailBytes = 0;
    this.tailStartsAtLineBoundary = false;
  }

  /** The command's exact totals, from the sandbox; the text after it (notices) still adds to them. */
  settle(totals: OutputTotals): void {
    this.addText(this.decoder.decode());
    this.totalBytes = totals.bytes;
    this.completedLines = totals.lines - (totals.openLineBytes > 0 ? 1 : 0);
    this.openLine = totals.openLineBytes > 0;
    this.currentLineBytes = totals.openLineBytes;
  }

  private addText(text: string): void {
    if (!text) return;
    const bytes = Buffer.byteLength(text, "utf-8");
    this.totalBytes += bytes;
    this.tail += text;
    this.tailBytes += bytes;
    if (this.tailBytes > this.rollingBytes * 2) this.trimTail();
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      this.currentLineBytes += bytes;
      this.openLine = true;
      return;
    }
    let newlines = 0;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) newlines += 1;
    this.completedLines += newlines;
    const rest = text.slice(lastNewline + 1);
    this.currentLineBytes = Buffer.byteLength(rest, "utf-8");
    this.openLine = rest.length > 0;
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tail, "utf-8");
    let start = buffer.length - this.rollingBytes;
    if (start <= 0) return;
    while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
    this.tailStartsAtLineBoundary = buffer[start - 1] === 0x0a;
    this.tail = buffer.subarray(start).toString("utf-8");
    this.tailBytes = Buffer.byteLength(this.tail, "utf-8");
  }

  snapshot(): OutputSnapshot {
    let text = this.tail;
    if (!this.tailStartsAtLineBoundary) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? text : text.slice(firstNewline + 1);
    }
    const shown = truncateTail(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    if (!this.truncated) return { text: shown.content, truncation: undefined };
    return {
      text: shown.content,
      truncation: {
        ...shown,
        truncated: true,
        truncatedBy: shown.truncatedBy ?? (this.totalBytes > DEFAULT_MAX_BYTES ? "bytes" : "lines"),
        totalLines: this.totalLines,
        totalBytes: this.totalBytes,
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      },
    };
  }

  /** The text the model reads, with Pi's truncation notice pointing at `fullOutputPath`. */
  format(fullOutputPath: string | undefined, emptyText = "(no output)"): { text: string; truncation: TruncationResult | undefined } {
    const { text, truncation } = this.snapshot();
    let out = text || emptyText;
    if (truncation) {
      const where = fullOutputPath ? `Full output: ${fullOutputPath}` : "The full output could not be kept";
      const startLine = truncation.totalLines - truncation.outputLines + 1;
      const endLine = truncation.totalLines;
      if (truncation.lastLinePartial) {
        out += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${formatSize(this.currentLineBytes)}). ${where}]`;
      } else if (truncation.truncatedBy === "lines") {
        out += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. ${where}]`;
      } else {
        out += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). ${where}]`;
      }
    }
    return { text: out, truncation };
  }
}
