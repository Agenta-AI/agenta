/**
 * Agenta Pi extension (WP-8): tracing + tools, installed into Pi's agent dir and loaded
 * by Pi when it runs under sandbox-agent (`pi --mode rpc` via pi-acp).
 *
 * This is how we keep WP-1/WP-2/WP-7 behavior on the sandbox-agent path: instead of a synthetic,
 * coarse tracer in the runner, we propagate the caller's trace context INTO Pi and let
 * Pi record its real span tree (turn / chat / tool, with token usage) under that parent —
 * and we deliver tools the Pi-native way (`registerTool`), each routing back to Agenta's
 * /tools/call, rather than over MCP. Pi is highly customizable; this leans on that.
 *
 * Stable paths are read from the environment (injected at the daemon's birth). Per-turn
 * telemetry data is delivered through a read-once control file. Tool env is
 * intentionally public-only; execution relays back to the runner where private specs/auth
 * remain in memory:
 *   AGENTA_AGENT_TELEMETRY_CONTROL_PATH path to the runner-written, read-once turn control
 *   Pi publishes raw OTLP batch siblings beside the control file
 *
 * Bundled self-contained (esbuild) so its OpenTelemetry deps resolve wherever Pi loads
 * it (local, the docker sidecar, a Daytona snapshot). Default export is the Pi
 * ExtensionFactory.
 */
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { createAgentaOtel } from "../tracing/otel.ts";
import { Redactor, curatedEnvSecretValues } from "../redaction.ts";
import { createPiFileSpanExporter } from "../tracing/pi-file-exporter.ts";
import {
  PI_TRACE_CONTROL_ENV,
  PI_TRACE_MAX_CONTROL_BYTES,
  parsePiTurnTraceControl,
  type PiTurnTraceControl,
} from "../tracing/pi-spool-protocol.ts";
import type { ResolvedToolSpec } from "../protocol.ts";
import { runResolvedTool } from "../tools/dispatch.ts";
import { EMPTY_OBJECT_SCHEMA } from "../tools/callback.ts";
import {
  approvalUnavailableText,
  refusedAtGateText,
} from "../tools/denial-text.ts";
import {
  assertRequiredArguments,
  requiredFields,
  specInputSchema,
} from "../tools/spec-schema.ts";
import { PUBLIC_SPECS_FILE_ENV } from "../tools/tool-mcp-env.ts";
import {
  buildPiGateEnvelope,
  PI_GATE_DIALOG_TITLE,
  type PiGateKind,
} from "../engines/sandbox_agent/pi-gate-envelope.ts";
import {
  decodePiModelProviderOverride,
  PI_MODEL_PROVIDER_OVERRIDE_ENV,
} from "./model-provider-override.ts";

/** Read and delete one runner-authored turn control. Invalid bytes never poison a warm turn. */
export function readPiTurnTraceControl(
  path?: string,
): PiTurnTraceControl | undefined {
  if (!path) return undefined;
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return undefined;
  }
  // Delete immediately after the successful read, before parsing, so malformed bytes cannot be
  // inherited by the next warm turn.
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
  if (bytes.byteLength > PI_TRACE_MAX_CONTROL_BYTES) {
    log(`trace control ignored: ${bytes.byteLength} bytes exceeds limit`);
    return undefined;
  }
  try {
    return parsePiTurnTraceControl(JSON.parse(bytes.toString("utf-8")));
  } catch (error) {
    log(
      `trace control ignored: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function log(message: string): void {
  process.stderr.write(`[agenta-pi-ext] ${message}\n`);
}

/**
 * The pre-file inline delivery of the public tool specs. Kept readable for ONE release so a
 * harness whose env was built by an older runner still sees its tools; the runner itself only
 * writes `PUBLIC_SPECS_FILE_ENV` now.
 */
const LEGACY_PUBLIC_SPECS_ENV = "AGENTA_AGENT_TOOLS_PUBLIC_SPECS";

/** The bundle cannot import the runner's identity table, so this copy is pinned against the
 *  shared golden in `tests/unit/pi-builtin-tools-parity.test.ts`. */
export const PI_BUILTIN_TOOL_NAMES = [
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
    return {
      allowed: false,
      reason: approvalUnavailableText(
        toolName,
        "this session has no approval dialog.",
      ),
    };
  }
  const message = buildPiGateEnvelope({ gate, toolName, toolCallId, input });
  try {
    const confirmed = await confirm.call(ui, PI_GATE_DIALOG_TITLE, message);
    // A confirm resolves to a BOOLEAN, so every refusal arrives here identical: a policy deny, a
    // human declining live, a stored decline replayed out of the conversation, and a fail-closed
    // reject. This used to answer "Denied by the permission policy.", which names a decider it
    // cannot know and was simply wrong whenever a human had declined one specific change: the
    // model read it as the tool being unavailable for the whole run and stopped asking. See
    // `refusedAtGateText` for why the honest message drops the attribution instead of guessing.
    return confirmed === true
      ? { allowed: true }
      : { allowed: false, reason: refusedAtGateText(toolName) };
  } catch (err) {
    // The thrown detail is the operational fault (a transport that died, a closed plane). It rides
    // the cause so a transcript still says WHAT broke, while the instruction stays the same,
    // because the model can do nothing different about one cause versus the other.
    return {
      allowed: false,
      reason: approvalUnavailableText(
        toolName,
        `the approval dialog failed (${err instanceof Error ? err.message : "unknown error"}).`,
      ),
    };
  }
}

function isPiBuiltinToolName(name: string): name is PiBuiltinToolName {
  return PI_BUILTIN_TOOL_NAME_SET.has(name);
}

export function replaceActiveBuiltinTools(
  activeTools: string[],
  allTools: Array<{ name: string }>,
): string[] {
  const builtinTools = [
    ...new Set(allTools.map((tool) => tool.name).filter(isPiBuiltinToolName)),
  ];

  let replacedBuiltinSlice = false;
  const next: string[] = [];
  for (const name of activeTools) {
    if (isPiBuiltinToolName(name)) {
      if (!replacedBuiltinSlice) {
        next.push(...builtinTools);
        replacedBuiltinSlice = true;
      }
      continue;
    }
    next.push(name);
  }

  if (!replacedBuiltinSlice) next.push(...builtinTools);
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

function blockReason(
  toolName: string,
  reason: string | undefined,
): ToolCallEventResult {
  return {
    block: true,
    reason: reason || refusedAtGateText(toolName),
  };
}

/** Pi alone activates only four builtins; Agenta activates every one it implements. */
function registerBuiltinActivation(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async () => {
    pi.setActiveTools(
      replaceActiveBuiltinTools(pi.getActiveTools(), pi.getAllTools()),
    );
  });
}

function registerBuiltinGating(pi: ExtensionAPI): void {
  pi.on(
    "tool_call",
    async (event, ctx): Promise<ToolCallEventResult | undefined> => {
      const toolName = builtinToolNameFromEvent(event);
      if (!toolName) return undefined;
      const { allowed, reason } = await piDialogAllows(
        ctx,
        "pi-builtin",
        toolName,
        event.toolCallId,
        event.input,
      );
      return allowed ? undefined : blockReason(toolName, reason);
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

/**
 * Load the run's public tool specs, preferring the runner-written FILE.
 *
 * The file is the delivery route: one env var holding every hydrated spec overflows Linux's
 * per-string `execve` limit (131,072 bytes) and kills the harness spawn with `E2BIG` before any
 * tool can be registered. The inline var remains a fallback for ONE release so a harness started
 * by an older runner — or a warm session whose env predates this deploy — still finds its tools;
 * remove it once no such process can be live.
 *
 * Returns `undefined` on any defect (unreadable file, bad JSON, non-array) after logging it: the
 * caller then registers nothing, which is the same outcome as before, but the reason is on stderr.
 */
function loadPublicToolSpecs():
  | { specs: ResolvedToolSpec[]; route: string }
  | undefined {
  const path = process.env[PUBLIC_SPECS_FILE_ENV];
  const raw = process.env[LEGACY_PUBLIC_SPECS_ENV];
  let json: string;
  let route: string;
  if (path) {
    route = `file ${path}`;
    try {
      json = readFileSync(path, "utf-8");
    } catch (err) {
      log(`cannot read tool specs ${route}: ${(err as Error).message}`);
      return undefined;
    }
  } else if (raw) {
    route = `env ${LEGACY_PUBLIC_SPECS_ENV}`;
    json = raw;
  } else {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    log(`bad tool specs in ${route}: ${(err as Error).message}`);
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    log(`tool specs in ${route} must be a JSON array`);
    return undefined;
  }
  return { specs: parsed as ResolvedToolSpec[], route };
}

/** Register public tool metadata as Pi tools whose execution relays to the runner. */
function registerTools(pi: ExtensionAPI): void {
  const relayDir = process.env.AGENTA_AGENT_TOOLS_RELAY_DIR;
  if (!relayDir) return;
  const loaded = loadPublicToolSpecs();
  if (!loaded) return;
  const specs = loaded.specs;

  let registered = 0;
  for (const spec of specs) {
    // Pi keys its tool registry by name, so registering a custom tool under a built-in name would
    // replace the built-in the platform activates on every run. The SDK refuses such a config;
    // skip it here too, for a request that reaches the runner some other way.
    if (isPiBuiltinToolName((spec.name ?? "").trim().toLowerCase())) {
      log(`skipped custom tool '${spec.name}': the name is a built-in tool`);
      continue;
    }
    // The dialog gate applies to EXECUTABLE custom tools only. `client` tools are
    // browser-fulfilled across a turn boundary through the relay's own pause semantics; gating
    // one via the dialog would be wrong, so they keep their path.
    const gateViaDialog = (spec.kind ?? "callback") !== "client";
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description ?? spec.name,
      promptSnippet: promptSnippet(spec),
      promptGuidelines: promptGuidelines(spec),
      // Pi accepts plain JSON Schema here (non-TypeBox validation path).
      parameters: (specInputSchema(spec) as any) ?? EMPTY_OBJECT_SCHEMA,
      // The positional shape (ctx 5th) is pi-coding-agent's registerTool execute contract. If
      // upstream changes the arity, the gate fails closed (no ui -> block); it never fails open.
      async execute(
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        _onUpdate?: unknown,
        ctx?: ExtensionContext,
      ) {
        // Validate BEFORE the gate: a malformed call must error to the model, never reach a
        // human as an approval prompt (and never relay as a no-op).
        assertRequiredArguments(spec, params);
        // Gate BEFORE the relay execution: only an allow proceeds. A deny surfaces as the tool's
        // result text, so the model loop continues.
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
                  text: reason ?? refusedAtGateText(spec.name),
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
  log(
    `registered ${registered} tool(s) from ${loaded.route} -> relay ${relayDir}`,
  );
}

/** The Pi ExtensionFactory: tools + (env-driven) tracing + usage writeback. */
const factory = (pi: ExtensionAPI): void => {
  const modelProviderOverrideRaw = process.env[PI_MODEL_PROVIDER_OVERRIDE_ENV];
  const modelProviderOverride =
    modelProviderOverrideRaw === undefined
      ? undefined
      : decodePiModelProviderOverride(modelProviderOverrideRaw);
  // Fully inert unless Agenta wired this run (so it is safe to install globally in a
  // shared Pi agent dir — a normal `pi` session with no Agenta env does nothing).
  const traceControlPath = process.env[PI_TRACE_CONTROL_ENV];
  const hasTracing = !!traceControlPath;
  const relayDir = process.env.AGENTA_AGENT_TOOLS_RELAY_DIR;
  const hasTools = !!(
    (process.env[PUBLIC_SPECS_FILE_ENV] ||
      process.env[LEGACY_PUBLIC_SPECS_ENV]) &&
    relayDir
  );
  const hasBuiltinActivation = isTruthyFlag(
    process.env.AGENTA_AGENT_BUILTIN_ACTIVATION,
  );
  const hasBuiltinGating = isTruthyFlag(
    process.env.AGENTA_AGENT_BUILTIN_GATING,
  );
  const usageOut = process.env.AGENTA_AGENT_USAGE_CAPTURE_PATH;
  if (
    !modelProviderOverride &&
    !hasTracing &&
    !hasTools &&
    !hasBuiltinActivation &&
    !hasBuiltinGating &&
    !usageOut
  )
    return;

  // Extension factories complete before Pi selects the configured model. Registering only a
  // baseUrl here overrides the built-in provider without replacing its model catalog or auth.
  if (modelProviderOverride) {
    pi.registerProvider(modelProviderOverride.provider, {
      baseUrl: modelProviderOverride.baseUrl,
    });
  }

  if (hasTools) registerTools(pi);
  if (hasBuiltinActivation) registerBuiltinActivation(pi);
  if (hasBuiltinGating) registerBuiltinGating(pi);
  // Pi records the native span tree and publishes raw OTLP bytes into its telemetry spool.
  // The runner owns the network export for both local and Daytona runs. Usage is also written
  // separately for the runner's response accounting.
  if (!hasTracing && !usageOut) return;

  const otel = createAgentaOtel({ enabled: false, captureContent: true });
  pi.on("before_agent_start", async () => {
    // Clear every turn-owned value first. A missing or malformed control must never reuse the
    // prior warm turn's traceparent, policy, redactor, channel, or usage.
    otel.beginTurn({ enabled: false, captureContent: true });
    if (usageOut) {
      try {
        unlinkSync(usageOut);
      } catch {
        // absent is the normal case; this only prevents stale warm-turn usage
      }
    }
    const control = readPiTurnTraceControl(traceControlPath);
    if (!control || !traceControlPath) return;
    const redactor = new Redactor({ mode: "known" }).withKnownSecrets([
      ...curatedEnvSecretValues(),
      ...control.redaction.knownValues,
    ]);
    otel.beginTurn({
      enabled: true,
      traceparent: control.propagation?.traceparent,
      baggage: control.propagation?.baggage,
      captureContent: control.capture.content,
      sessionId: control.sessionId,
      turnId: control.turnId,
      skills: control.skills,
      redactor,
      serializedBatchTransport: createPiFileSpanExporter({
        directory: dirname(traceControlPath),
        channelId: control.channelId,
        log,
      }),
    });
  });
  otel.register(pi); // lifecycle handlers (spans + usage accumulation)

  pi.on("agent_end", async () => {
    if (otel.config.enabled) await otel.flush();
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
