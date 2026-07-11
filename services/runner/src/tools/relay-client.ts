/**
 * In-sandbox relay writer client: publish one `<id>.req.json` request file and wait for
 * the `<id>.res.json` response the runner writes back (see tools/relay.ts for the
 * runner-side loop).
 *
 * This module runs INSIDE the sandbox (bundled into the Pi extension, and consumed by
 * the future in-sandbox MCP shim, #5234), so it MUST stay bundle-safe: it may import
 * ONLY node builtins and ./relay-protocol.ts — never server-side runner modules.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { dirname } from "node:path";

import {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  RELAY_TIMEOUT_MS,
  relayTempPath,
  sanitizeRelayId,
  serializeRelayRequest,
  sleep,
  type ExecuteRelayRequest,
  type RelayResponse,
} from "./relay-protocol.ts";

/**
 * Write one execute request file into the relay dir. Returns the request path and the
 * response path the runner will answer on. Publication is atomic (plan decision 2): the
 * bytes go to a temp name first and a same-directory rename publishes the final name, so
 * the runner's reader can never observe partial JSON. The final on-disk bytes are
 * unchanged (the golden test pins them).
 */
export function publishRelayRequest(
  dir: string,
  req: ExecuteRelayRequest,
): { reqPath: string; resPath: string } {
  const id = sanitizeRelayId(req.toolCallId);
  const reqPath = `${dir}/${id}${RELAY_REQ_SUFFIX}`;
  const resPath = `${dir}/${id}${RELAY_RES_SUFFIX}`;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // The runner also creates it; a race here is harmless.
  }
  const tmpPath = relayTempPath(reqPath);
  writeFileSync(tmpPath, serializeRelayRequest(req), "utf-8");
  renameSync(tmpPath, reqPath);
  return { reqPath, resPath };
}

/** Thrown by `waitForRelayResponse` when the deadline passes with no response file. */
export class RelayTimeoutError extends Error {
  constructor(resPath: string) {
    super(`tool relay timed out waiting on ${resPath}`);
    this.name = "RelayTimeoutError";
  }
}

/**
 * Hop-1 response-watch kill switch (plan decision 7), read at CALL time so a test or an
 * operator restart takes effect immediately. Default true; only the exact strings
 * "false" and "0" disable it.
 */
export function responseWatchEnabled(): boolean {
  const value = process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
  return value !== "false" && value !== "0";
}

export interface RelayDirWatch {
  /**
   * Wait for the next directory event or `timeoutMs`, whichever comes first. A pending
   * event that arrived while no waiter was armed resolves immediately ("activity").
   */
  wait: (timeoutMs: number) => Promise<"activity" | "timeout">;
  close: () => void;
}

/**
 * Coalescing directory watch (the plan's decision-3 activity-source shape, single-waiter
 * form): ONE `fs.watch` is armed at creation and any event — eventType and filename are
 * ignored entirely, filenames may be absent per the Node docs — sets a sticky pending
 * bit and wakes the current waiter, if any. `wait()` consumes the sticky bit, so an
 * event that lands between two waits stays observable; a timer win clears the waiter and
 * an event win clears the timer, so thousands of consecutive waits accumulate zero
 * listeners and zero timers (the watch callback is attached exactly once, at creation).
 *
 * Degradation, never rejection: a synchronous `fs.watch` throw returns undefined (the
 * caller falls back to a plain poll); a watcher "error" after creation closes the
 * watcher, and every later `wait()` resolves via its timer only.
 *
 * Single consumer: at most one `wait()` may be pending at a time (a second concurrent
 * `wait()` orphans the first waiter's wake), and a `wait()` after `close()` resolves
 * "timeout" immediately — a caller looping on `wait()` must stop once it closed the
 * watch.
 */
export function createRelayDirWatch(dir: string): RelayDirWatch | undefined {
  let pending = false;
  let waiter: ((outcome: "activity" | "timeout") => void) | undefined;
  let closed = false;

  const notify = (): void => {
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve("activity");
    } else {
      pending = true;
    }
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(dir, notify);
  } catch {
    return undefined;
  }
  // Degrade on a post-creation watcher error: stop watching, let waits time out. Never
  // reject and never leave the "error" event unhandled (an unlistened EventEmitter
  // "error" would throw).
  watcher.on("error", () => {
    try {
      watcher.close();
    } catch {
      // Already closed; nothing to release.
    }
  });

  return {
    wait: (timeoutMs) => {
      if (pending) {
        pending = false;
        return Promise.resolve("activity");
      }
      if (closed) return Promise.resolve("timeout");
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiter = undefined;
          resolve("timeout");
        }, timeoutMs);
        waiter = (outcome) => {
          clearTimeout(timer);
          resolve(outcome);
        };
      });
    },
    close: () => {
      if (closed) return;
      closed = true;
      try {
        watcher.close();
      } catch {
        // Already closed; nothing to release.
      }
      if (waiter) {
        // Resolve an in-flight wait as a timer win; the hop-1 caller just re-checks
        // existsSync and hits its deadline as usual.
        const resolve = waiter;
        waiter = undefined;
        resolve("timeout");
      }
    },
  };
}

/**
 * Wait for the runner's response file until it appears, the signal aborts, or the
 * deadline passes. The caller computes the total timeout; this function checks the
 * abort per iteration, reads and parses the file when it exists, and otherwise waits up
 * to RELAY_POLL_MS between checks. Throws `Error("aborted")` on abort and a
 * `RelayTimeoutError` at the deadline.
 *
 * Hop 1 of the event-driven relay (plan decisions 3, 6, 7): when the response watch is
 * enabled (default), a directory watch is armed BEFORE the first existsSync check —
 * arm-then-check closes the created-before-armed race — and each sleep becomes a wait
 * that a directory event cuts short. The RELAY_POLL_MS cadence survives as the racing
 * safety timer, so the watch only shortens sleeps, never lengthens them; abort is still
 * noticed at worst one poll interval later, exactly as today. A watch that cannot be
 * created degrades to the plain poll.
 */
export async function waitForRelayResponse(
  resPath: string,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<RelayResponse> {
  const deadline = Date.now() + opts.timeoutMs;
  const dirWatch = responseWatchEnabled()
    ? createRelayDirWatch(dirname(resPath))
    : undefined;
  try {
    while (Date.now() < deadline) {
      if (opts.signal?.aborted) throw new Error("aborted");
      if (existsSync(resPath)) {
        return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
      }
      if (dirWatch) await dirWatch.wait(RELAY_POLL_MS);
      else await sleep(RELAY_POLL_MS);
    }
    throw new RelayTimeoutError(resPath);
  } finally {
    dirWatch?.close();
  }
}

/**
 * Daytona tool call: the in-sandbox process can't reach Agenta, so write the request to a
 * file the runner watches and poll for the response it writes back (see tools/relay.ts).
 */
export async function relayToolCall(
  dir: string,
  toolName: string,
  toolCallId: string,
  params: unknown,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<string> {
  const { reqPath, resPath } = publishRelayRequest(dir, {
    toolName,
    toolCallId,
    args: params,
  });

  const totalTimeoutMs =
    timeoutMs && timeoutMs > 0 ? timeoutMs + 10_000 : RELAY_TIMEOUT_MS;
  let res: RelayResponse;
  try {
    res = await waitForRelayResponse(resPath, {
      timeoutMs: totalTimeoutMs,
      signal,
    });
  } catch (err) {
    if (err instanceof RelayTimeoutError) {
      throw new Error(`tool relay timed out for ${toolName}`);
    }
    throw err;
  }
  try {
    unlinkSync(reqPath);
  } catch {
    /* best-effort cleanup */
  }
  try {
    unlinkSync(resPath);
  } catch {
    /* best-effort cleanup */
  }
  if (res.ok) return res.text ?? "";
  throw new Error(res.error || `tool relay failed for ${toolName}`);
}
