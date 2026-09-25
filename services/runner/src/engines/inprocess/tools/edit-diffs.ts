/**
 * Each edit's text before and after, captured inside the edit itself (after the permission gate,
 * through the confined file system) and handed to pi-acp when the edit's result is reported, so
 * the event mapping never touches a file.
 */
import type { EditDiff } from "pi-acp/session";

/** A diff larger than this is not shown; the edit's own message still is. */
export const MAX_DIFF_TEXT_BYTES = 1024 * 1024;

export class EditDiffs {
  private readonly byToolCall = new Map<string, EditDiff>();

  record(toolCallId: string, diff: EditDiff): void {
    if (Buffer.byteLength(diff.oldText) > MAX_DIFF_TEXT_BYTES || Buffer.byteLength(diff.newText) > MAX_DIFF_TEXT_BYTES) return;
    this.byToolCall.set(toolCallId, diff);
  }

  take(toolCallId: string): EditDiff | undefined {
    const diff = this.byToolCall.get(toolCallId);
    this.byToolCall.delete(toolCallId);
    return diff;
  }
}
