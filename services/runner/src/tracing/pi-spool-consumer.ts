import { join } from "node:path";

import {
  PI_TRACE_CONTROL_FILE,
  PI_TRACE_FILE_SUFFIX,
  PI_TRACE_MAX_BATCH_BYTES,
  PI_TRACE_MAX_FILES,
  isPiTraceChannelId,
  isPiTraceSpoolFileName,
} from "./pi-spool-protocol.ts";
import {
  publishTelemetryFileAtomic,
  type TelemetryFileHost,
} from "./telemetry-file-host.ts";

export const PI_TRACE_DRAIN_TIMEOUT_MS = 750;
export const PI_TRACE_DRAIN_POLL_MS = 50;
export const PI_TRACE_SWEEP_MAX_FILES = 64;
const PI_TRACE_LIST_ATTEMPTS = 3;
const PI_TRACE_LIST_RETRY_MS = 25;

export interface PiTraceSpoolBatch {
  channelId: string;
  sequence: number;
  path: string;
  bytes: Uint8Array;
}

export interface PiTraceSpoolDrainResult {
  pickedUp: number;
  forwarded: number;
  oversized: number;
  unreadControl: boolean;
  limitReached: boolean;
}

export interface PiTraceSpoolConsumer {
  /** Directory creation and the start-of-turn stale sweep. Never rejects. */
  ready: Promise<void>;
  /** Atomically publish the read-once control file. False means tracing was skipped. */
  publishControl: (contents: Uint8Array | string) => Promise<boolean>;
  /** Pick up and forward every bounded current-channel batch available by the deadline. */
  drain: () => Promise<PiTraceSpoolDrainResult>;
  /** Remove telemetry-owned residue and report what was found. Never rejects. */
  teardown: () => Promise<void>;
}

export interface PiTraceSpoolConsumerOptions {
  host: TelemetryFileHost;
  dir: string;
  channelId: string;
  onBatch: (batch: PiTraceSpoolBatch) => Promise<void> | void;
  maxBatchBytes?: number;
  maxFiles?: number;
  drainTimeoutMs?: number;
  pollMs?: number;
  log?: (message: string) => void;
  /** Test seam for deterministic bounded drains. */
  now?: () => number;
  /** Test seam for deterministic bounded drains and list retries. */
  sleep?: (ms: number) => Promise<void>;
}

interface SweepOptions {
  host: TelemetryFileHost;
  dir: string;
  phase: "start" | "teardown";
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
  maxFiles?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conciseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isOwnedTelemetryFile(name: string): boolean {
  return (
    isPiTraceSpoolFileName(name) ||
    name.startsWith(`${PI_TRACE_CONTROL_FILE}.tmp.`)
  );
}

async function listWithRetries(
  host: TelemetryFileHost,
  dir: string,
  sleep: (ms: number) => Promise<void>,
  log: (message: string) => void,
  stage: string,
  maxEntries: number,
): Promise<string[] | undefined> {
  for (let attempt = 1; attempt <= PI_TRACE_LIST_ATTEMPTS; attempt += 1) {
    try {
      return await host.list(dir, maxEntries);
    } catch (err) {
      if (attempt === PI_TRACE_LIST_ATTEMPTS) {
        log(
          `stage=${stage} list_failed=true attempts=${attempt} error=${conciseError(err)}`,
        );
        return undefined;
      }
      await sleep(PI_TRACE_LIST_RETRY_MS);
    }
  }
  return undefined;
}

/** Bounded cleanup of files owned by the telemetry protocol. */
export async function sweepPiTraceSpoolFiles({
  host,
  dir,
  phase,
  log,
  sleep,
  maxFiles = PI_TRACE_SWEEP_MAX_FILES,
}: SweepOptions): Promise<void> {
  const names = await listWithRetries(
    host,
    dir,
    sleep,
    log,
    "pi_trace_spool_sweep",
    maxFiles + 1,
  );
  if (!names) return;

  const owned = names.filter(isOwnedTelemetryFile);
  if (phase === "teardown" && names.includes(PI_TRACE_CONTROL_FILE)) {
    log("stage=pi_trace_control unread=true phase=teardown");
  }
  let removed = 0;
  let removeFailed = 0;
  for (const name of owned.slice(0, Math.max(0, maxFiles))) {
    try {
      await host.remove(join(dir, name));
      removed += 1;
    } catch (err) {
      removeFailed += 1;
      log(
        `stage=pi_trace_spool_sweep phase=${phase} remove_failed=true file=${name} error=${conciseError(err)}`,
      );
    }
  }

  if (owned.length > 0) {
    const leftovers = owned.length - removed;
    log(
      `stage=pi_trace_spool_sweep phase=${phase} found=${owned.length} removed=${removed} leftovers=${leftovers} remove_failed=${removeFailed}`,
    );
  }
}

function currentChannelSequence(
  name: string,
  channelId: string,
): number | undefined {
  const prefix = `${channelId}.`;
  if (!name.startsWith(prefix) || !name.endsWith(PI_TRACE_FILE_SUFFIX)) {
    return undefined;
  }
  const raw = name.slice(prefix.length, -PI_TRACE_FILE_SUFFIX.length);
  if (!/^\d+$/.test(raw)) return undefined;
  const sequence = Number(raw);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  cap: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(cap, Math.max(1, Math.floor(value!)));
}

/** Runner-side pickup for raw OTLP protobuf batches authored by Pi. */
export function createPiTraceSpoolConsumer(
  options: PiTraceSpoolConsumerOptions,
): PiTraceSpoolConsumer {
  if (!isPiTraceChannelId(options.channelId)) {
    throw new Error("Pi trace spool channelId is invalid");
  }

  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const maxBatchBytes = boundedInteger(
    options.maxBatchBytes,
    PI_TRACE_MAX_BATCH_BYTES,
    PI_TRACE_MAX_BATCH_BYTES,
  );
  const maxFiles = boundedInteger(
    options.maxFiles,
    PI_TRACE_MAX_FILES,
    PI_TRACE_MAX_FILES,
  );
  const drainTimeoutMs = Math.max(
    0,
    Math.floor(options.drainTimeoutMs ?? PI_TRACE_DRAIN_TIMEOUT_MS),
  );
  const pollMs = Math.max(
    1,
    Math.floor(options.pollMs ?? PI_TRACE_DRAIN_POLL_MS),
  );
  const seenSequences = new Set<number>();
  const controlPath = join(options.dir, PI_TRACE_CONTROL_FILE);

  const ready = (async () => {
    try {
      await options.host.mkdir(options.dir);
      await sweepPiTraceSpoolFiles({
        host: options.host,
        dir: options.dir,
        phase: "start",
        log,
        sleep,
      });
    } catch (err) {
      log(`stage=pi_trace_spool_start failed=true error=${conciseError(err)}`);
    }
  })();

  const drain = async (): Promise<PiTraceSpoolDrainResult> => {
    await ready;
    const result: PiTraceSpoolDrainResult = {
      pickedUp: 0,
      forwarded: 0,
      oversized: 0,
      unreadControl: false,
      limitReached: false,
    };
    const deadline = now() + drainTimeoutMs;
    const maxPolls = Math.max(1, Math.ceil(drainTimeoutMs / pollMs) + 1);
    const pickedUpBatches: PiTraceSpoolBatch[] = [];

    for (let poll = 0; poll < maxPolls; poll += 1) {
      const names = await listWithRetries(
        options.host,
        options.dir,
        sleep,
        log,
        "pi_trace_spool_drain",
        PI_TRACE_SWEEP_MAX_FILES + 1,
      );
      if (names) {
        if (names.includes(PI_TRACE_CONTROL_FILE) && !result.unreadControl) {
          result.unreadControl = true;
          log("stage=pi_trace_control unread=true");
        }

        const candidates = names
          .map((name) => ({
            name,
            sequence: currentChannelSequence(name, options.channelId),
          }))
          .filter(
            (candidate): candidate is { name: string; sequence: number } =>
              candidate.sequence !== undefined &&
              !seenSequences.has(candidate.sequence),
          )
          .sort((a, b) => a.sequence - b.sequence);

        for (const candidate of candidates) {
          if (result.pickedUp >= maxFiles) {
            result.limitReached = true;
            break;
          }
          const path = join(options.dir, candidate.name);
          if (seenSequences.has(candidate.sequence)) {
            await options.host.remove(path).catch(() => {});
            log(
              `stage=pi_trace_spool_pickup sequence=${candidate.sequence} duplicate=true`,
            );
            continue;
          }
          const size = await options.host.statSize(path);
          if (size === undefined) {
            log(
              `stage=pi_trace_spool_pickup sequence=${candidate.sequence} stat_failed=true`,
            );
            continue;
          }
          if (size > maxBatchBytes) {
            seenSequences.add(candidate.sequence);
            result.pickedUp += 1;
            result.oversized += 1;
            await options.host.remove(path).catch(() => {});
            log(
              `stage=pi_trace_spool_pickup sequence=${candidate.sequence} oversized=true size=${size} limit=${maxBatchBytes}`,
            );
            continue;
          }

          let bytes: Uint8Array;
          try {
            bytes = await options.host.readBytes(path, maxBatchBytes);
          } catch (err) {
            log(
              `stage=pi_trace_spool_pickup sequence=${candidate.sequence} read_failed=true error=${conciseError(err)}`,
            );
            continue;
          }
          seenSequences.add(candidate.sequence);
          result.pickedUp += 1;
          if (bytes.byteLength > maxBatchBytes) {
            result.oversized += 1;
            await options.host.remove(path).catch(() => {});
            log(
              `stage=pi_trace_spool_pickup sequence=${candidate.sequence} oversized_after_read=true size=${bytes.byteLength} limit=${maxBatchBytes}`,
            );
            continue;
          }

          // Delete-on-pickup prevents a later poll from forwarding the same batch. Collect every
          // bounded file before starting network I/O, so one slow collector cannot hide a later
          // file that Pi publishes within the pickup window.
          await options.host.remove(path).catch((err) => {
            log(
              `stage=pi_trace_spool_pickup sequence=${candidate.sequence} remove_failed=true error=${conciseError(err)}`,
            );
          });
          pickedUpBatches.push({
            channelId: options.channelId,
            sequence: candidate.sequence,
            path,
            bytes,
          });
        }
      }

      if (result.pickedUp >= maxFiles) {
        result.limitReached = true;
        break;
      }
      if (now() >= deadline || poll + 1 >= maxPolls) break;
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    }
    await Promise.all(
      pickedUpBatches.map(async (batch) => {
        try {
          await options.onBatch(batch);
          result.forwarded += 1;
        } catch (err) {
          log(
            `stage=pi_trace_spool_export sequence=${batch.sequence} failed=true error=${conciseError(err)}`,
          );
        }
      }),
    );
    return result;
  };

  return {
    ready,
    publishControl: async (contents) => {
      await ready;
      try {
        await publishTelemetryFileAtomic(options.host, controlPath, contents);
        return true;
      } catch (err) {
        log(
          `stage=pi_trace_control publish_failed=true error=${conciseError(err)}`,
        );
        return false;
      }
    },
    drain,
    teardown: async () => {
      await ready;
      await sweepPiTraceSpoolFiles({
        host: options.host,
        dir: options.dir,
        phase: "teardown",
        log,
        sleep,
      }).catch((err) => {
        log(
          `stage=pi_trace_spool_teardown failed=true error=${conciseError(err)}`,
        );
      });
    },
  };
}
