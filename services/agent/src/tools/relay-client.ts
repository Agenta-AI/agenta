/**
 * File-relay CLIENT — the in-sandbox half of the Daytona tool relay.
 *
 * The runner-side relay loop (`tools/relay.ts` `startToolRelay`) executes resolved tool specs and
 * answers via files in a sandbox dir. This module is the other end: an in-sandbox process writes a
 * `<id>.req.json` request and polls for the `<id>.res.json` the runner writes back. It is split
 * out of `tools/dispatch.ts` so the standalone in-sandbox shim (`tools/relay-mcp-stdio.ts`) can
 * bundle ONLY the file-relay code — NOT the direct callback/code executors `dispatch.ts` also
 * imports (a credentialed `/tools/call` POST and the code runner have no business in a sandbox
 * child). `dispatch.ts` re-exports `relayToolCall` from here so its callers are unchanged.
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
  sleep,
  type RelayResponse,
} from "./relay.ts";

/**
 * Daytona tool call from inside the sandbox: the in-sandbox process can't reach Agenta, so write
 * the request to a file the runner watches and poll for the response it writes back (see
 * `tools/relay.ts`). Returns the result text; throws on a relay error or timeout.
 */
export async function relayToolCall(
  dir: string,
  toolName: string,
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const id = sanitizeRelayId(toolCallId);
  const reqPath = `${dir}/${id}${RELAY_REQ_SUFFIX}`;
  const resPath = `${dir}/${id}${RELAY_RES_SUFFIX}`;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // The runner also creates it; a race here is harmless.
  }
  writeFileSync(
    reqPath,
    JSON.stringify({ toolName, toolCallId, args: params ?? {} }),
    "utf-8",
  );

  const deadline = Date.now() + RELAY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");
    if (existsSync(resPath)) {
      const res = JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
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
    await sleep(RELAY_POLL_MS);
  }
  throw new Error(`tool relay timed out for ${toolName}`);
}
