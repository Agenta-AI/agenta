/**
 * What the in-process sessions of this runner hold, and whether it can take one more.
 *
 * Sessions share one Node process, so one session's growth is every session's problem. The ledger
 * counts, per session, the bytes it holds in the two places that grow with use: its transcript
 * (Pi's message list, measured after each turn) and the output buffers of commands it is running.
 * The process-wide external and ArrayBuffer memory is reported beside them; no API attributes it
 * to a session.
 * Admission refuses a new session, with a sentence the person can act on, when this runner already
 * hosts its maximum number of sessions or when the V8 heap is above the configured share of its
 * limit. It does not bound one session's own growth.
 */
import { getHeapStatistics } from "node:v8";
import { withPublicCode } from "../sandbox_agent/errors.ts";

export const RUNNER_AT_CAPACITY_MESSAGE =
  "This agent service is at capacity right now, so the session did not start. Send the message again in a moment.";

export interface SessionFootprint {
  transcriptBytes: number;
  outputBytes: number;
}

export interface LedgerSnapshot {
  sessions: number;
  transcriptBytes: number;
  outputBytes: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  /** Memory outside the V8 heap (buffers, streams): no per-session figure exists for it. */
  externalBytes: number;
  arrayBufferBytes: number;
}

export interface SessionLedgerOptions {
  maxSessions: number;
  heapPressureRatio: number;
  /** Heap figures; injectable for tests. */
  heap?: () => { used: number; limit: number };
}

export class SessionLedger {
  private readonly sessions = new Map<string, { transcriptBytes: number; outputs: Set<{ bufferedBytes: number }> }>();
  private readonly heap: () => { used: number; limit: number };

  constructor(private readonly options: SessionLedgerOptions) {
    this.heap =
      options.heap ??
      (() => {
        const stats = getHeapStatistics();
        return { used: stats.used_heap_size, limit: stats.heap_size_limit };
      });
  }

  /**
   * Take a seat for `sessionId`, or throw a public `runner_capacity` error when a new session must
   * not start now. The check and the seat are one synchronous step, so sessions opening at the same
   * time can never pass the cap together. The seat is given back by `close`.
   */
  admit(sessionId: string): void {
    if (this.sessions.has(sessionId)) return;
    if (this.sessions.size >= this.options.maxSessions) throw withPublicCode(new Error(RUNNER_AT_CAPACITY_MESSAGE), "runner_capacity");
    const { used, limit } = this.heap();
    if (limit > 0 && used / limit > this.options.heapPressureRatio) throw withPublicCode(new Error(RUNNER_AT_CAPACITY_MESSAGE), "runner_capacity");
    this.sessions.set(sessionId, { transcriptBytes: 0, outputs: new Set() });
  }

  close(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  setTranscriptBytes(sessionId: string, bytes: number): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.transcriptBytes = bytes;
  }

  /** Count a command's output buffer against the session while the command runs. */
  trackOutput(sessionId: string, output: { bufferedBytes: number }): () => void {
    const entry = this.sessions.get(sessionId);
    entry?.outputs.add(output);
    return () => entry?.outputs.delete(output);
  }

  footprint(sessionId: string): SessionFootprint | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    let outputBytes = 0;
    for (const output of entry.outputs) outputBytes += output.bufferedBytes;
    return { transcriptBytes: entry.transcriptBytes, outputBytes };
  }

  snapshot(): LedgerSnapshot {
    let transcriptBytes = 0;
    let outputBytes = 0;
    for (const id of this.sessions.keys()) {
      const f = this.footprint(id)!;
      transcriptBytes += f.transcriptBytes;
      outputBytes += f.outputBytes;
    }
    const { used, limit } = this.heap();
    const { external, arrayBuffers } = process.memoryUsage();
    return { sessions: this.sessions.size, transcriptBytes, outputBytes, heapUsedBytes: used, heapLimitBytes: limit, externalBytes: external, arrayBufferBytes: arrayBuffers };
  }
}
