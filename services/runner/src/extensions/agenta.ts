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
 *   AGENTA_AGENT_OTLP_AUTH_FILE       path to a runner-written, 0600, read-once file holding
 *                                     the OTLP Authorization bearer (never a plain env
 *                                     var — read once here, then deleted, see readOtlpAuthFile)
 *   AGENTA_AGENT_CONTENT_CAPTURE_ENABLED "false" to drop prompt/completion/tool I/O from spans
 *   AGENTA_AGENT_TOOLS_PUBLIC_SPECS   JSON [{ name, description, inputSchema }]
 *   AGENTA_AGENT_TOOLS_RELAY_DIR      relay tool calls through the runner via files here
 *   AGENTA_AGENT_SKILLS_LOADED        JSON [skillName] of skills that loaded this run (F-029)
 *
 * Bundled self-contained (esbuild) so its OpenTelemetry deps resolve wherever Pi loads
 * it (local, the docker sidecar, a Daytona snapshot). Default export is the Pi
 * ExtensionFactory.
 */
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { createAgentaOtel } from "../tracing/otel.ts";
import type { ResolvedToolSpec } from "../protocol.ts";
import { EMPTY_OBJECT_SCHEMA } from "../tools/callback.ts";
import { requiredFields, specInputSchema } from "../tools/spec-schema.ts";
import {
  buildPiGateEnvelope,
  PI_GATE_DIALOG_TITLE,
  type PiGateKind,
} from "../engines/sandbox_agent/pi-gate-envelope.ts";

/** Read the OTLP bearer from its runner-written file once, then best-effort delete it. */
export function readOtlpAuthFile(path?: string): string | undefined {
  if (!path) return undefined;
  let value: string;
  try {
    value = readFileSync(path, "utf-8").trim();
  } catch {
    return undefined;
  }
  // Delete is best-effort and must not drop a bearer we already read (runner cleanup also removes it).
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
  return value || undefined;
}
import { relayPermissionCheck, runResolvedTool } from "../tools/dispatch.ts";

function log(message: string): void {
  process.stderr.write(`[agenta-pi-ext] ${message}\n`);
}

const PI_BUILTIN_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

type PiBuiltinToolName = (typeof PI_BUILTIN_TOOL_NAMES)[number];

const PI_BUILTIN_TOOL_NAME_SET = new Set<string>(PI_BUILTIN_TOOL_NAMES);

function isTruthyFlag(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * Raise a Pi approval gate as an extension-UI dialog carrying the JSON envelope, instead of the
 * file-relay poll. The `pi-acp` bridge surfaces this as a real ACP `session/request_permission`
 * the runner holds, classifies, and (under keep-alive) parks. No `opts` are passed to `confirm`,
 * so Pi arms no reaper and the dialog waits indefinitely; any cancellation resolves it to `false`,
 * which is a fail-closed block. If the UI plane is somehow unavailable, block (never run
 * unapproved).
 */
async function piDialogAllows(
  ctx: ExtensionContext | undefined,
  gate: PiGateKind,
  toolName: string,
  toolCallId: string,
  input: unknown,
): Promise<{ allowed: boolean; reason?: string }> {
  const ui = ctx?.ui;
  const confirm = ui?.confirm;
  if (!ui || typeof confirm !== "function") {
    return { allowed: false, reason: "Permission dialog is unavailable." };
  }
  const message = buildPiGateEnvelope({ gate, toolName, toolCallId, input });
  try {
    const confirmed = await confirm.call(ui, PI_GATE_DIALOG_TITLE, message);
    return confirmed === true
      ? { allowed: true }
      : { allowed: false, reason: "Denied by the permission policy." };
  } catch (err) {
    return {
      allowed: false,
      reason: err instanceof Error ? err.message : "Permission dialog failed.",
    };
  }
}

function isPiBuiltinToolName(name: string): name is PiBuiltinToolName {
  return PI_BUILTIN_TOOL_NAME_SET.has(name);
}

export function normalizeBuiltinGrants(
  raw: string | undefined,
  logDrop: (message: string) => void = log,
): PiBuiltinToolName[] {
  if (!raw) return [];
  const grants: PiBuiltinToolName[] = [];
  const seen = new Set<string>();
  const unknown = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (!isPiBuiltinToolName(name)) {
      if (!unknown.has(name)) {
        unknown.add(name);
        logDrop(`dropping unknown builtin grant '${name}'`);
      }
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    grants.push(name);
  }
  return grants;
}

export function replaceActiveBuiltinTools(
  activeTools: string[],
  allTools: Array<{ name: string }>,
  builtinGrants: readonly PiBuiltinToolName[],
): string[] {
  const grantSet = new Set<string>(builtinGrants);
  const inserted = new Set<string>();
  const grantedBuiltinTools = allTools
    .map((tool) => tool.name)
    .filter(isPiBuiltinToolName)
    .filter((name) => {
      if (!grantSet.has(name) || inserted.has(name)) return false;
      inserted.add(name);
      return true;
    });

  let replacedBuiltinSlice = false;
  const next: string[] = [];
  for (const name of activeTools) {
    if (isPiBuiltinToolName(name)) {
      if (!replacedBuiltinSlice) {
        next.push(...grantedBuiltinTools);
        replacedBuiltinSlice = true;
      }
      continue;
    }
    next.push(name);
  }

  if (!replacedBuiltinSlice) next.push(...grantedBuiltinTools);
  return next;
}

function builtinToolNameFromEvent(
  event: ToolCallEvent,
): PiBuiltinToolName | undefined {
  if (isToolCallEventType("read", event)) return "read";
  if (isToolCallEventType("bash", event)) return "bash";
  if (isToolCallEventType("edit", event)) return "edit";
  if (isToolCallEventType("write", event)) return "write";
  if (isToolCallEventType("grep", event)) return "grep";
  if (isToolCallEventType("find", event)) return "find";
  if (isToolCallEventType("ls", event)) return "ls";
  return undefined;
}

function blockReason(reason: string | undefined): ToolCallEventResult {
  return {
    block: true,
    reason: reason || "Denied by the permission policy.",
  };
}

function registerBuiltinGating(
  pi: ExtensionAPI,
  relayDir: string | undefined,
  builtinGrants: readonly PiBuiltinToolName[],
  dialogGate: boolean,
): void {
  pi.on("before_agent_start", async () => {
    pi.setActiveTools(
      replaceActiveBuiltinTools(
        pi.getActiveTools(),
        pi.getAllTools(),
        builtinGrants,
      ),
    );
  });

  pi.on(
    "tool_call",
    async (event, ctx): Promise<ToolCallEventResult | undefined> => {
      const toolName = builtinToolNameFromEvent(event);
      if (!toolName) return undefined;

      // Dialog plane (flag on): the gate rides `ctx.ui.confirm`, so the runner holds and can park
      // it. The relay path stays behind the flag for rollback.
      if (dialogGate) {
        const { allowed, reason } = await piDialogAllows(
          ctx,
          "pi-builtin",
          toolName,
          event.toolCallId,
          event.input,
        );
        return allowed ? undefined : blockReason(reason);
      }

      if (!relayDir) {
        return blockReason(
          "Permission check denied because the relay directory is missing.",
        );
      }

      try {
        const response = await relayPermissionCheck(
          relayDir,
          toolName,
          event.toolCallId,
          event.input,
        );
        if (response.verdict === "allow") return undefined;
        return blockReason(response.reason);
      } catch (err) {
        return blockReason(
          err instanceof Error ? err.message : "Permission check failed.",
        );
      }
    },
  );
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
function registerTools(pi: ExtensionAPI, dialogGate: boolean): void {
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
    // The dialog gate applies to EXECUTABLE custom tools only. `client` tools are
    // browser-fulfilled across a turn boundary through the relay's own pause semantics; gating
    // one via the dialog would be wrong, so they keep today's path.
    const gateViaDialog = dialogGate && (spec.kind ?? "callback") !== "client";
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description ?? spec.name,
      promptSnippet: promptSnippet(spec),
      promptGuidelines: promptGuidelines(spec),
      // Pi accepts plain JSON Schema here (non-TypeBox validation path).
      parameters: (specInputSchema(spec) as any) ?? EMPTY_OBJECT_SCHEMA,
      async execute(
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        _onUpdate?: unknown,
        ctx?: ExtensionContext,
      ) {
        // Gate BEFORE the relay execution: only an allow proceeds. A deny surfaces as the tool's
        // result text (mirroring the relay's own deny), so the model loop continues.
        if (gateViaDialog) {
          const { allowed, reason } = await piDialogAllows(
            ctx,
            "pi-custom-tool",
            spec.name,
            toolCallId,
            params,
          );
          if (!allowed) {
            return {
              content: [
                {
                  type: "text",
                  text: reason ?? "Denied by the permission policy.",
                },
              ],
              details: { toolName: spec.name },
            };
          }
        }
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
  const relayDir = process.env.AGENTA_AGENT_TOOLS_RELAY_DIR;
  const hasTools = !!(process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS && relayDir);
  const hasBuiltinGating = isTruthyFlag(
    process.env.AGENTA_AGENT_BUILTIN_GATING,
  );
  const builtinGrants = normalizeBuiltinGrants(
    process.env.AGENTA_AGENT_BUILTIN_GRANTS,
  );
  // Approval parking (Option C): route both Pi gates over the extension-UI dialog plane instead
  // of the file relay, so the runner can hold and park an ask. Runner-side flag
  // AGENTA_RUNNER_PI_DIALOG_GATE -> sandbox AGENTA_AGENT_PI_DIALOG_GATE (buildPiExtensionEnv).
  // Default off: with it off, both gates keep the byte-identical relay path.
  const dialogGate = isTruthyFlag(process.env.AGENTA_AGENT_PI_DIALOG_GATE);
  const usageOut = process.env.AGENTA_AGENT_USAGE_CAPTURE_PATH;
  if (!hasTracing && !hasTools && !hasBuiltinGating && !usageOut) return;

  if (hasTools) registerTools(pi, dialogGate);
  if (hasBuiltinGating)
    registerBuiltinGating(pi, relayDir, builtinGrants, dialogGate);
  // Tracing exports the span tree (when the OTLP target is reachable, i.e. local runs).
  // Usage accumulation is needed both for that export AND for the writeback the runner
  // uses on Daytona (where the in-sandbox process can't reach Agenta's OTLP, so the
  // runner traces from the event stream and only needs the token totals). So set up the
  // otel state whenever either applies; only flush (export) when tracing is on.
  if (!hasTracing && !usageOut) return;

  const otel = createAgentaOtel({
    traceparent: process.env.TRACEPARENT,
    endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    authorization: readOtlpAuthFile(process.env.AGENTA_AGENT_OTLP_AUTH_FILE),
    captureContent:
      process.env.AGENTA_AGENT_CONTENT_CAPTURE_ENABLED !== "false",
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
