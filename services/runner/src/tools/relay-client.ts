/**
 * In-sandbox relay writer client: publish one `<id>.req.json` request file and poll for
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
  unlinkSync,
  writeFileSync,
} from "node:fs";

import {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  RELAY_TIMEOUT_MS,
  sanitizeRelayId,
  serializeRelayRequest,
  sleep,
  type ExecuteRelayRequest,
  type RelayResponse,
} from "./relay-protocol.ts";

/**
 * Write one execute request file into the relay dir. Returns the request path and the
 * response path the runner will answer on. (Atomic write-temp-then-rename comes in a
 * later slice; today this is a plain write, same as it always was.)
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
  writeFileSync(reqPath, serializeRelayRequest(req), "utf-8");
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
 * Poll for the runner's response file until it appears, the signal aborts, or the
 * deadline passes. The caller computes the total timeout; this function checks the
 * abort per poll, reads and parses the file when it exists, and sleeps RELAY_POLL_MS
 * between checks. Throws `Error("aborted")` on abort and a `RelayTimeoutError` at the
 * deadline.
 */
export async function waitForRelayResponse(
  resPath: string,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<RelayResponse> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("aborted");
    if (existsSync(resPath)) {
      return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
    }
    await sleep(RELAY_POLL_MS);
  }
  throw new RelayTimeoutError(resPath);
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
