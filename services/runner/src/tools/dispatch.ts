/**
 * Shared tool dispatch: execute one backend-resolved tool, branching on its executor `kind`.
 *
 * The same "branch on spec.kind to run a resolved tool" logic was duplicated across the
 * delivery paths (extensions/agenta.ts Pi-under-sandbox-agent, tools/mcp-server.ts the MCP
 * bridge). This module owns that dispatch ONCE so a change to how a kind is executed is a
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
 * `relayToolCall` lives here (not in extensions/agenta.ts) so this module is the single
 * dispatch home with no import cycle back into a call site.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import type { ResolvedToolSpec } from "../protocol.ts";
import { callAgentaTool } from "./callback.ts";
import { runCodeTool } from "./code.ts";
import { assertRequiredArguments } from "./spec-schema.ts";
import {
  RELAY_PERMISSION_PROTOCOL,
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  RELAY_TIMEOUT_MS,
  parsePermissionRelayResponse,
  sanitizeRelayId,
  sleep,
  type PermissionRelayRequest,
  type PermissionRelayResponse,
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

function oneLineReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim() || "Permission check failed.";
}

function denyPermissionRelayResponse(reason: string): PermissionRelayResponse {
  return {
    kind: "permission",
    ok: false,
    verdict: "deny",
    reason: oneLineReason(reason),
  };
}

/**
 * Pi builtin permission check: write a permission request into the same relay directory the
 * runner watches for tool execution, then poll for its permission response. The extension must
 * fail closed because returning nothing lets Pi execute the builtin.
 */
export async function relayPermissionCheck(
  dir: string,
  toolName: string,
  toolCallId: string,
  args: unknown,
): Promise<PermissionRelayResponse> {
  const id = sanitizeRelayId(toolCallId);
  const reqPath = `${dir}/${id}${RELAY_REQ_SUFFIX}`;
  const resPath = `${dir}/${id}${RELAY_RES_SUFFIX}`;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // The runner also creates it; a race here is harmless.
  }

  const req: PermissionRelayRequest = {
    kind: "permission",
    protocol: RELAY_PERMISSION_PROTOCOL,
    toolName,
    toolCallId,
    args: args ?? {},
  };
  try {
    writeFileSync(reqPath, JSON.stringify(req), "utf-8");
  } catch (err) {
    return denyPermissionRelayResponse(
      `permission relay request for ${toolName} could not be written: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const cleanup = (): void => {
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
  };

  const deadline = Date.now() + RELAY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(resPath)) {
      let parsed: PermissionRelayResponse | undefined;
      try {
        parsed = parsePermissionRelayResponse(
          JSON.parse(readFileSync(resPath, "utf-8")),
        );
      } catch {
        cleanup();
        return denyPermissionRelayResponse(
          `permission relay response for ${toolName} was unparseable`,
        );
      }
      cleanup();
      if (!parsed) {
        return denyPermissionRelayResponse(
          `permission relay response for ${toolName} was unparseable`,
        );
      }
      if (!parsed.ok) {
        return denyPermissionRelayResponse(
          parsed.reason || `permission relay failed for ${toolName}`,
        );
      }
      return parsed;
    }
    await sleep(RELAY_POLL_MS);
  }
  try {
    unlinkSync(reqPath);
  } catch {
    /* best-effort cleanup */
  }
  return denyPermissionRelayResponse(
    `permission relay timed out for ${toolName}`,
  );
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
    return runCodeTool(
      spec.runtime,
      spec.code ?? "",
      spec.env,
      params,
      opts.signal,
    );
  }
  if (spec.kind === "client") {
    if (opts.relayDir) {
      return relayToolCall(
        opts.relayDir,
        spec.name,
        opts.toolCallId,
        params,
        opts.signal,
      );
    }
    throw new Error(
      `client tool '${spec.name}' is browser-fulfilled and cannot be executed`,
    );
  }
  // callback (default): route back to Agenta's /tools/call (directly or via the Daytona relay).
  if (opts.relayDir) {
    return relayToolCall(
      opts.relayDir,
      spec.name,
      opts.toolCallId,
      params,
      opts.signal,
    );
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
