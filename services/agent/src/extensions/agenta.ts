/**
 * Agenta Pi extension (WP-8): tracing + tools, installed into Pi's agent dir and loaded
 * by Pi when it runs under sandbox-agent (`pi --mode rpc` via pi-acp).
 *
 * This is how we keep WP-1/WP-2/WP-7 behavior on the sandbox-agent path: instead of a synthetic,
 * coarse tracer in the runner, we propagate the caller's trace context INTO Pi and let
 * Pi emit its real span tree (turn / chat / tool, with token usage) under that parent —
 * and we deliver tools the Pi-native way (`registerTool`), each routing back to Agenta's
 * /tools/call, rather than over MCP. Pi is highly customizable; this leans on that.
 *
 * Everything is read from the environment (injected at the daemon's birth). Tool env is
 * intentionally public-only; execution relays back to the runner where private specs/auth
 * remain in memory:
 *   TRACEPARENT                       W3C traceparent of the caller's /invoke span
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT  OTLP traces URL (e.g. https://host/api/otlp/v1/traces)
 *   OTEL_EXPORTER_OTLP_HEADERS        key=value list for export headers (e.g. Authorization=...)
 *   AGENTA_AGENT_CONTENT_CAPTURE_ENABLED "false" to drop prompt/completion/tool I/O from spans
 *   AGENTA_AGENT_TOOLS_PUBLIC_SPECS   JSON [{ name, description, inputSchema }]
 *   AGENTA_AGENT_TOOLS_RELAY_DIR      relay tool calls through the runner via files here
 *   AGENTA_AGENT_SKILLS_LOADED        JSON [skillName] of skills that loaded this run (F-029)
 *
 * Bundled self-contained (esbuild) so its OpenTelemetry deps resolve wherever Pi loads
 * it (local, the docker sidecar, a Daytona snapshot). Default export is the Pi
 * ExtensionFactory.
 */
import { writeFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createAgentaOtel } from "../tracing/otel.ts";
import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA } from "../tools/callback.ts";
import { requiredFields, specInputSchema } from "../tools/spec-schema.ts";

/** Pull the Authorization value out of an OTEL_EXPORTER_OTLP_HEADERS key=value list. */
function authorizationFromOtlpHeaders(raw?: string): string | undefined {
  if (!raw) return undefined;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim().toLowerCase() === "authorization") {
      return pair.slice(eq + 1).trim();
    }
  }
  return undefined;
}
import { runResolvedTool } from "../tools/dispatch.ts";

function log(message: string): void {
  process.stderr.write(`[agenta-pi-ext] ${message}\n`);
}

function promptSnippet(spec: ResolvedToolSpec): string {
  return spec.description ?? `Call ${spec.name}`;
}

function promptGuidelines(spec: ResolvedToolSpec): string[] {
  const guidelines: string[] = [];
  const required = requiredFields(specInputSchema(spec));
  if (required.length > 0) {
    guidelines.push(
      `When calling ${spec.name}, include the required argument(s): ${required.join(", ")}.`,
    );
  }
  if (spec.name === "request_connection") {
    guidelines.push(
      "When calling request_connection, set integration to the lowercase provider key such as slack or github; use mode oauth unless the user explicitly asks for an API key.",
    );
  }
  if (spec.name === "commit_revision") {
    guidelines.push(
      "When calling commit_revision, include workflow_revision.data with the updated workflow configuration, usually workflow_revision.data.parameters.agent for agent-template changes.",
    );
  }
  return guidelines;
}

/** Parse the JSON array of loaded skill names from AGENTA_AGENT_SKILLS_LOADED; [] on absent/malformed. */
function parseSkillsLoaded(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

/** Register public tool metadata as Pi tools whose execution relays to the runner. */
function registerTools(pi: ExtensionAPI): void {
  const raw = process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS;
  const relayDir = process.env.AGENTA_AGENT_TOOLS_RELAY_DIR;
  if (!raw || !relayDir) return;

  let specs: ResolvedToolSpec[] = [];
  try {
    specs = JSON.parse(raw);
  } catch (err) {
    log(`bad AGENTA_AGENT_TOOLS_PUBLIC_SPECS: ${(err as Error).message}`);
    return;
  }

  let registered = 0;
  for (const spec of specs) {
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description ?? spec.name,
      promptSnippet: promptSnippet(spec),
      promptGuidelines: promptGuidelines(spec),
      // Pi accepts plain JSON Schema here (non-TypeBox validation path).
      parameters: (specInputSchema(spec) as any) ?? EMPTY_OBJECT_SCHEMA,
      async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
        const text = await runResolvedTool(spec, params, {
          toolCallId,
          relayDir,
          signal,
        });
        return {
          content: [{ type: "text", text }],
          details: { toolName: spec.name },
        };
      },
    } as any);
    registered += 1;
  }
  log(`registered ${registered} tool(s) -> relay ${relayDir}`);
}

/** The Pi ExtensionFactory: tools + (env-driven) tracing + usage writeback. */
const factory = (pi: ExtensionAPI): void => {
  // Fully inert unless Agenta wired this run (so it is safe to install globally in a
  // shared Pi agent dir — a normal `pi` session with no Agenta env does nothing).
  const hasTracing = !!(
    process.env.TRACEPARENT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  );
  const hasTools = !!(
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS &&
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR
  );
  const usageOut = process.env.AGENTA_AGENT_USAGE_CAPTURE_PATH;
  if (!hasTracing && !hasTools && !usageOut) return;

  if (hasTools) registerTools(pi);
  // Tracing exports the span tree (when the OTLP target is reachable, i.e. local runs).
  // Usage accumulation is needed both for that export AND for the writeback the runner
  // uses on Daytona (where the in-sandbox process can't reach Agenta's OTLP, so the
  // runner traces from the event stream and only needs the token totals). So set up the
  // otel state whenever either applies; only flush (export) when tracing is on.
  if (!hasTracing && !usageOut) return;

  const otel = createAgentaOtel({
    traceparent: process.env.TRACEPARENT,
    endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    authorization: authorizationFromOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    captureContent: process.env.AGENTA_AGENT_CONTENT_CAPTURE_ENABLED !== "false",
    // The skills that loaded for this run (author + forced `_agenta.*`), stamped on the agent
    // span so a trace shows which skills surfaced (F-029). A JSON array string from the runner.
    skills: parseSkillsLoaded(process.env.AGENTA_AGENT_SKILLS_LOADED),
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
