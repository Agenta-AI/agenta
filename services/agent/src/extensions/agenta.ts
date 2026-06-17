/**
 * Agenta Pi extension (WP-8): tracing + tools, installed into Pi's agent dir and loaded
 * by Pi when it runs under rivet (`pi --mode rpc` via pi-acp).
 *
 * This is how we keep WP-1/WP-2/WP-7 behavior on the rivet path: instead of a synthetic,
 * coarse tracer in the runner, we propagate the caller's trace context INTO Pi and let
 * Pi emit its real span tree (turn / chat / tool, with token usage) under that parent —
 * and we deliver tools the Pi-native way (`registerTool`), each routing back to Agenta's
 * /tools/call, rather than over MCP. Pi is highly customizable; this leans on that.
 *
 * Everything is read from the environment (injected at the daemon's birth), so nothing
 * run-specific is written to the agent-visible filesystem:
 *   AGENTA_TRACEPARENT            W3C traceparent of the caller's /invoke span
 *   AGENTA_OTLP_ENDPOINT          OTLP traces URL (e.g. https://host/api/otlp/v1/traces)
 *   AGENTA_OTLP_AUTHORIZATION     Authorization header for the OTLP export
 *   AGENTA_CAPTURE_CONTENT        "false" to drop prompt/completion/tool I/O from spans
 *   AGENTA_TOOL_SPECS             JSON [{ name, description, inputSchema, callRef }]
 *   AGENTA_TOOL_CALLBACK_ENDPOINT full /tools/call URL
 *   AGENTA_TOOL_CALLBACK_AUTH     Authorization header for the callback
 *   AGENTA_TOOL_RELAY_DIR         set on Daytona: relay tool calls through the runner via
 *                                 files here, since the sandbox can't reach Agenta directly
 *
 * Bundled self-contained (esbuild) so its OpenTelemetry deps resolve wherever Pi loads
 * it (local, the docker sidecar, a Daytona snapshot). Default export is the Pi
 * ExtensionFactory.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createAgentaOtel } from "../tracing/otel.ts";
import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA, callAgentaTool } from "../tools/client.ts";
import {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  RELAY_TIMEOUT_MS,
  sanitizeRelayId,
  sleep,
  type RelayResponse,
} from "../tools/relay.ts";

function log(message: string): void {
  process.stderr.write(`[agenta-pi-ext] ${message}\n`);
}

/**
 * Daytona tool call: the in-sandbox process can't reach Agenta, so write the request to a
 * file the runner watches and poll for the response it writes back (see tools/relay.ts).
 */
async function relayToolCall(
  dir: string,
  callRef: string,
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
  writeFileSync(reqPath, JSON.stringify({ callRef, toolCallId, args: params ?? {} }), "utf-8");

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

/** Register the resolved tools (from env) as Pi tools that call back to Agenta. */
function registerTools(pi: ExtensionAPI): void {
  const raw = process.env.AGENTA_TOOL_SPECS;
  const endpoint = process.env.AGENTA_TOOL_CALLBACK_ENDPOINT;
  if (!raw || !endpoint) return;

  let specs: ResolvedToolSpec[] = [];
  try {
    specs = JSON.parse(raw);
  } catch (err) {
    log(`bad AGENTA_TOOL_SPECS: ${(err as Error).message}`);
    return;
  }
  const authorization = process.env.AGENTA_TOOL_CALLBACK_AUTH;
  // Daytona: the in-sandbox process can't reach Agenta, so tool calls are relayed through
  // the runner via files in this dir. Unset for local runs (direct /tools/call).
  const relayDir = process.env.AGENTA_TOOL_RELAY_DIR;

  for (const spec of specs) {
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description ?? spec.name,
      // Pi accepts plain JSON Schema here (non-TypeBox validation path).
      parameters: (spec.inputSchema as any) ?? EMPTY_OBJECT_SCHEMA,
      async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
        const text = relayDir
          ? await relayToolCall(relayDir, spec.callRef, toolCallId, params, signal)
          : await callAgentaTool(endpoint, authorization, spec.callRef, toolCallId, params, signal);
        return { content: [{ type: "text", text }], details: { callRef: spec.callRef } };
      },
    } as any);
  }
  log(`registered ${specs.length} tool(s) -> ${relayDir ? `relay ${relayDir}` : endpoint}`);
}

/** The Pi ExtensionFactory: tools + (env-driven) tracing + usage writeback. */
const factory = (pi: ExtensionAPI): void => {
  // Fully inert unless Agenta wired this run (so it is safe to install globally in a
  // shared Pi agent dir — a normal `pi` session with no Agenta env does nothing).
  const hasTracing = !!(process.env.AGENTA_TRACEPARENT || process.env.AGENTA_OTLP_ENDPOINT);
  const hasTools = !!(process.env.AGENTA_TOOL_SPECS && process.env.AGENTA_TOOL_CALLBACK_ENDPOINT);
  const usageOut = process.env.AGENTA_USAGE_OUT;
  if (!hasTracing && !hasTools && !usageOut) return;

  if (hasTools) registerTools(pi);
  // Tracing exports the span tree (when the OTLP target is reachable, i.e. local runs).
  // Usage accumulation is needed both for that export AND for the writeback the runner
  // uses on Daytona (where the in-sandbox process can't reach Agenta's OTLP, so the
  // runner traces from the event stream and only needs the token totals). So set up the
  // otel state whenever either applies; only flush (export) when tracing is on.
  if (!hasTracing && !usageOut) return;

  const otel = createAgentaOtel({
    traceparent: process.env.AGENTA_TRACEPARENT,
    endpoint: process.env.AGENTA_OTLP_ENDPOINT,
    authorization: process.env.AGENTA_OTLP_AUTHORIZATION,
    captureContent: process.env.AGENTA_CAPTURE_CONTENT !== "false",
  });
  otel.register(pi); // lifecycle handlers (spans + usage accumulation)

  pi.on("agent_end", async () => {
    if (hasTracing) await otel.flush(); // invoke_agent has a remote parent → flush by id
    if (usageOut) {
      try {
        writeFileSync(usageOut, JSON.stringify(otel.usage()), "utf-8");
      } catch (err) {
        log(`usage writeback skipped: ${(err as Error).message}`);
      }
    }
  });
};

export default factory;
