/**
 * Shared tool dispatch: execute one backend-resolved tool, branching on its executor `kind`.
 *
 * The same "branch on spec.kind to run a resolved tool" logic was duplicated across the
 * delivery paths (the Pi extension and internal MCP channels). This module owns that dispatch
 * once so a change to how a kind is executed is a
 * one-line edit, not several. Each call site still keeps its OWN result-wrapping shape (the Pi
 * extension's tool details, the MCP `content` envelope) and its OWN advertise/skip behavior
 * for `client` tools — only the execution itself is shared.
 *
 * The three executor kinds (see `ResolvedToolSpec`):
 *  - `code`: advertised to harnesses, but rejected by the sidecar as unsupported.
 *  - `client`: browser-fulfilled across a turn boundary; permission responder pauses it.
 *  - `callback` (default): POST back through Agenta's /tools/call so the Composio key and
 *    connection auth stay server-side. On Daytona the in-sandbox process can't reach Agenta,
 *    so the call is relayed through the runner via files (see tools/relay.ts) when `relayDir`
 *    is set; otherwise it POSTs directly.
 *
 * `relayToolCall` now lives in tools/relay-client.ts (the bundle-safe in-sandbox writer)
 * and is re-exported here so existing importers keep working.
 */
import type { ResolvedToolSpec } from "../protocol.ts";
import { callAgentaTool } from "./callback.ts";
import { CODE_TOOL_UNSUPPORTED_MESSAGE } from "./code.ts";
import { relayToolCall, RELAY_PAUSED } from "./relay-client.ts";
import { assertRequiredArguments } from "./spec-schema.ts";

// Compatibility re-export: the writer moved to `relay-client.ts`; importers that still
// reach it through this module keep working while they migrate.
export { relayToolCall } from "./relay-client.ts";

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
 * This dispatch path (the Pi extension and the local loopback MCP) never opts into the cold-pause
 * protocol — `writePausedAnswer` is off for Pi and the local MCP parks in-process — so a
 * `RELAY_PAUSED` reaching here is a contract violation. Fail loud rather than laundering the
 * sentinel into a string; only the in-sandbox shim handles a pause.
 */
function assertNotPaused(
  name: string,
  result: string | typeof RELAY_PAUSED,
): string {
  if (result === RELAY_PAUSED) {
    throw new Error(`unexpected paused relay answer for tool '${name}'`);
  }
  return result;
}

/**
 * Execute one resolved tool and return its result text. Throws on failure; every call site
 * turns the throw into a tool-error result so the model loop continues rather than crashing.
 *
 *  - `code`   -> reject as unsupported by the sidecar, no callback/relay.
 *  - `client` → relay to the runner so it can pause the browser-fulfilled call.
 *  - default/`callback` → relay through the runner when `opts.relayDir` is set (Daytona),
 *    else POST directly to `opts.endpoint`.
 */
export async function runResolvedTool(
  spec: ResolvedToolSpec,
  params: unknown,
  opts: RunResolvedToolOpts,
): Promise<string> {
  assertRequiredArguments(spec, params);
  if (spec.kind === "code") {
    // Code execution was removed (F-010). A code tool is refused up front in `buildRunPlan`;
    // this inline throw is the defense-in-depth backstop so a code spec that reaches dispatch
    // fails loud rather than falling through to the callback default and laundering into an
    // `ok:true` reply (F-016).
    throw new Error(CODE_TOOL_UNSUPPORTED_MESSAGE);
  }
  if (spec.kind === "client") {
    if (opts.relayDir) {
      return assertNotPaused(
        spec.name,
        await relayToolCall(
          opts.relayDir,
          spec.name,
          opts.toolCallId,
          params,
          spec.timeoutMs,
          opts.signal,
        ),
      );
    }
    throw new Error(
      `client tool '${spec.name}' is browser-fulfilled and cannot be executed`,
    );
  }
  // callback (default): route back to Agenta's /tools/call (directly or via the Daytona relay).
  if (opts.relayDir) {
    return assertNotPaused(
      spec.name,
      await relayToolCall(
        opts.relayDir,
        spec.name,
        opts.toolCallId,
        params,
        spec.timeoutMs,
        opts.signal,
      ),
    );
  }
  return callAgentaTool(
    opts.endpoint ?? "",
    opts.authorization,
    spec.callRef ?? "",
    opts.toolCallId,
    params,
    { signal: opts.signal, timeoutMs: spec.timeoutMs },
  );
}
