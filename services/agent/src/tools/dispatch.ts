/**
 * Shared tool dispatch: execute one backend-resolved tool, branching on its executor `kind`.
 *
 * The same "branch on spec.kind to run a resolved tool" logic was duplicated across every
 * delivery path (engines/pi.ts in-process Pi, extensions/agenta.ts Pi-under-rivet,
 * tools/mcp-server.ts the MCP bridge). This module owns that dispatch ONCE so a change to how
 * a kind is executed is a one-line edit, not three. Each call site still keeps its OWN
 * result-wrapping shape (Pi customTool details, the MCP `content` envelope) and its OWN
 * advertise/skip behavior for `client` tools — only the execution itself is shared.
 *
 * The three executor kinds (see `ResolvedToolSpec`):
 *  - `code`: run the snippet in a sandbox subprocess with its scoped secret `env`.
 *  - `client`: browser-fulfilled across a turn boundary; never executed in-sandbox (throws).
 *  - `callback` (default): POST back through Agenta's /tools/call so the Composio key and
 *    connection auth stay server-side. On Daytona the in-sandbox process can't reach Agenta,
 *    so the call is relayed through the runner via files (see tools/relay.ts) when `relayDir`
 *    is set; otherwise it POSTs directly.
 *
 * `relayToolCall` lives here (not in extensions/agenta.ts) so this module is the single
 * dispatch home with no import cycle back into a call site.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import type { ResolvedToolSpec } from "../protocol.ts";
import { callAgentaTool } from "./callback.ts";
import { runCodeTool } from "./code.ts";
import {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  RELAY_TIMEOUT_MS,
  sanitizeRelayId,
  sleep,
  type RelayResponse,
} from "./relay.ts";

/** Options for executing a resolved tool. `endpoint`/`authorization`/`relayDir` only matter for callbacks. */
export interface RunResolvedToolOpts {
  /** Stable id for this tool call (used as the /tools/call id and the relay filename). */
  toolCallId: string;
  /** /tools/call endpoint for `callback` tools. */
  endpoint?: string;
  /** Authorization header for the callback. */
  authorization?: string;
  /** Daytona relay dir: when set, callback calls are relayed through the runner via files. */
  relayDir?: string;
  /** Caller cancellation, combined with the per-tool timeout. */
  signal?: AbortSignal;
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
  writeFileSync(reqPath, JSON.stringify({ toolName, toolCallId, args: params ?? {} }), "utf-8");

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
      throw new Error(res.error || `tool relay failed for ${callRef}`);
    }
    await sleep(RELAY_POLL_MS);
  }
  throw new Error(`tool relay timed out for ${callRef}`);
}

/**
 * Execute one resolved tool and return its result text. Throws on failure; every call site
 * turns the throw into a tool-error result so the model loop continues rather than crashing.
 *
 *  - `code`   → run the snippet locally (scoped secret env), no callback/relay.
 *  - `client` → throw: browser-fulfilled, never executed in-sandbox.
 *  - default/`callback` → relay through the runner when `opts.relayDir` is set (Daytona),
 *    else POST directly to `opts.endpoint`.
 */
export async function runResolvedTool(
  spec: ResolvedToolSpec,
  params: unknown,
  opts: RunResolvedToolOpts,
): Promise<string> {
  if (spec.kind === "code") {
    return runCodeTool(spec.runtime, spec.code ?? "", spec.env, params, opts.signal);
  }
  if (spec.kind === "client") {
    throw new Error(
      `client tool '${spec.name}' is browser-fulfilled and cannot be executed in-sandbox`,
    );
  }
  // callback (default): route back to Agenta's /tools/call (directly or via the Daytona relay).
  if (opts.relayDir) {
    return relayToolCall(opts.relayDir, spec.name, opts.toolCallId, params, opts.signal);
  }
  return callAgentaTool(
    opts.endpoint ?? "",
    opts.authorization,
    spec.callRef ?? "",
    opts.toolCallId,
    params,
    opts.signal,
  );
}
