/**
 * WP-2 Pi harness driver.
 *
 * This is the concrete "harness" behind the service's Harness port. It drives the
 * Pi SDK (`createAgentSession`) for a single run: it injects the agent's AGENTS.md
 * in memory, resolves the model, sends one user turn, and returns the final
 * assistant text. It also turns the backend-resolved runnable tools (WP-7) into Pi
 * customTools that route back through Agenta's /tools/call. No streaming and no
 * session persistence yet; those are later work packages.
 *
 * Auth: uses `AuthStorage.create()`, which reads ~/.pi/agent/auth.json (the local
 * Pi login). Set OPENAI_API_KEY / ANTHROPIC_API_KEY in the environment as an
 * alternative. Nothing invocation-specific is written to a persistent disk: the
 * session is in-memory and the working dir is a throwaway temp dir.
 *
 * Important: stdout is reserved for the JSON result (see cli.ts). Everything here
 * logs to stderr so it never pollutes the result channel.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { createAgentaOtel } from "./agenta-otel.ts";

export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Trace context threaded in from the Agenta service so the agent run joins the
 * caller's /invoke trace instead of starting its own. All fields are optional;
 * with none set the run is traced standalone (or not at all) using env config.
 */
export interface TraceContext {
  /** W3C traceparent of the caller's workflow span. Nests invoke_agent under it. */
  traceparent?: string;
  /** W3C baggage from the caller (carried for future use). */
  baggage?: string;
  /** OTLP traces endpoint (e.g. https://host/api/otlp/v1/traces). */
  endpoint?: string;
  /** Full Authorization header for the OTLP export (e.g. "ApiKey ..." / "Secret ..."). */
  authorization?: string;
  /** Drop prompt/completion/tool I/O from spans when false. Default true. */
  captureContent?: boolean;
}

/**
 * A runnable tool the backend already resolved from the agent config: name +
 * description + JSON-Schema params for the model, plus the `callRef` slug the
 * execution bridge sends back to Agenta's /tools/call. The Composio key and the
 * connection auth stay server-side; this sandbox never sees them.
 */
export interface ResolvedToolSpec {
  /** Function name shown to the model (e.g. "gmail__SEND_EMAIL"). */
  name: string;
  /** Description shown to the model. Resolved live from the provider catalog. */
  description?: string;
  /** JSON Schema for the tool arguments. Pi accepts plain JSON Schema here. */
  inputSchema?: Record<string, unknown> | null;
  /** "tools.{provider}.{integration}.{action}.{connection}" — the /tools/call slug. */
  callRef: string;
}

/**
 * Where and how to route a tool call back through Agenta. The backend builds the
 * full /tools/call URL and threads the same credential the OTLP export rides on.
 */
export interface ToolCallbackContext {
  /** Full /tools/call URL. */
  endpoint: string;
  /** Authorization header value for the callback (project-scoped). */
  authorization?: string;
}

export interface AgentRunRequest {
  /** Harness id for the rivet backend ("pi" / "claude"). Ignored by the Pi backend. */
  harness?: string;
  /** Sandbox for the rivet backend ("local" / "daytona"). Ignored by the Pi backend. */
  sandbox?: string;
  /** Continue a prior run by replaying its history. The rivet backend resumes by id. */
  sessionId?: string;
  /** Provider API keys as env vars ({OPENAI_API_KEY,...}), resolved from the vault.
   *  Injected into the harness env; empty means the harness uses its own login (OAuth). */
  secrets?: Record<string, string>;
  /** AGENTS.md text injected as the agent's instructions (in memory). */
  agentsMd?: string;
  /** Model id ("gpt-5.5") or "provider/id" ("openai-codex/gpt-5.5"). */
  model?: string;
  /** The user turn to send. Falls back to the last user message. */
  prompt?: string;
  /** Optional prior message history. MVP sends the latest user turn only. */
  messages?: ChatMessage[];
  /** Built-in tools to enable. MVP default: none. */
  tools?: string[];
  /** Resolved runnable tools (WP-7), turned into Pi customTools below. */
  customTools?: ResolvedToolSpec[];
  /** Where customTools route their calls back to. Required when customTools is set. */
  toolCallback?: ToolCallbackContext;
  /** Tracing: thread the Agenta trace context across the boundary. */
  trace?: TraceContext;
}

export interface AgentRunResult {
  ok: boolean;
  output?: string;
  sessionId?: string;
  model?: string;
  /** Trace id of the run (the caller's trace when a traceparent was passed). */
  traceId?: string;
  /** Run token/cost totals, for roll-up onto the caller's workflow span. */
  usage?: { input: number; output: number; total: number; cost: number };
  error?: string;
}

function log(message: string): void {
  process.stderr.write(`[pi-wrapper] ${message}\n`);
}

/** Pick the requested model, else gpt-5.5, else a sensible non-mini default. */
function pickModel(available: any[], wanted?: string): any {
  return (
    (wanted &&
      available.find(
        (m) => m.id === wanted || `${m.provider}/${m.id}` === wanted,
      )) ||
    available.find((m) => m.id === "gpt-5.5") ||
    available.find((m) => !/spark|mini/i.test(m.id)) ||
    available[0]
  );
}

/** The latest user turn: explicit prompt, else last user message content. */
function resolvePrompt(request: AgentRunRequest): string {
  if (request.prompt && request.prompt.trim()) return request.prompt;
  const messages = request.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content) {
      return messages[i].content;
    }
  }
  return "";
}

/** Concatenate the text blocks of the last assistant message. */
function extractAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block: any) => block?.type === "text" && block.text)
        .map((block: any) => block.text)
        .join("");
      if (text) return text;
    }
  }
  return "";
}

/** Per-tool budget for the /tools/call round-trip. Surfaced as a tool error on timeout. */
const TOOL_CALL_TIMEOUT_MS = Number(
  process.env.AGENTA_AGENT_TOOL_CALL_TIMEOUT_MS ?? 30000,
);

/** Permissive default when a resolved tool has no input schema. */
const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

/**
 * Turn resolved tool specs into Pi customTools. Each tool's `execute` does one
 * POST back through Agenta's /tools/call, so Pi runs the loop while the Composio
 * key and connection auth stay server-side. A failed call throws, which Pi turns
 * into a tool-error result (the loop continues) rather than a run failure.
 */
export function buildCustomTools(
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
): any[] {
  if (specs.length === 0) return [];
  if (!callback?.endpoint) {
    log(`skipping ${specs.length} custom tool(s): missing toolCallback endpoint`);
    return [];
  }

  return specs.map((spec) => ({
    name: spec.name,
    label: spec.name,
    description: spec.description ?? spec.name,
    // Pi accepts a plain JSON Schema for `parameters` (its validator has a
    // non-TypeBox path); the schema is resolved live from the provider catalog.
    parameters: (spec.inputSchema as any) ?? EMPTY_OBJECT_SCHEMA,
    async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
      const text = await callAgentaTool(
        callback,
        spec.callRef,
        toolCallId,
        params,
        signal,
      );
      return {
        content: [{ type: "text", text }],
        details: { callRef: spec.callRef },
      };
    },
  }));
}

/** One /tools/call round-trip. Returns the result string; throws on failure. */
async function callAgentaTool(
  callback: ToolCallbackContext,
  callRef: string,
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (callback.authorization) headers["authorization"] = callback.authorization;

  // Combine Pi's abort signal (if any) with a per-tool timeout.
  const timeoutSignal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS);
  const anyOf = (AbortSignal as any).any;
  const combined =
    signal && typeof anyOf === "function"
      ? anyOf([signal, timeoutSignal])
      : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(callback.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          id: toolCallId,
          type: "function",
          // Arguments as an object (not a JSON string) to avoid double-encoding.
          function: { name: callRef, arguments: params ?? {} },
        },
      }),
      signal: combined,
    });
  } catch (err) {
    throw new Error(
      `tool call ${callRef} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `tool call ${callRef} returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
    );
  }

  // ToolCallResponse -> { call: { data: { content }, status } }. `content` is the
  // execution result serialized as a JSON string; hand it to the model verbatim.
  try {
    const parsed = JSON.parse(bodyText);
    const content = parsed?.call?.data?.content;
    if (typeof content === "string") return content;
    if (content != null) return JSON.stringify(content);
    return bodyText;
  } catch {
    return bodyText;
  }
}

export async function runPi(request: AgentRunRequest): Promise<AgentRunResult> {
  const prompt = resolvePrompt(request);
  if (!prompt) {
    return { ok: false, error: "No user message to send (prompt/messages empty)." };
  }

  const cwd = mkdtempSync(join(tmpdir(), "agenta-agent-"));

  try {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const available = await modelRegistry.getAvailable();
    if (!available || available.length === 0) {
      return {
        ok: false,
        error:
          "No model available. Log in with `pnpm exec pi` -> /login, or set OPENAI_API_KEY / ANTHROPIC_API_KEY.",
      };
    }

    const model = pickModel(available, request.model);
    log(`model: ${model.provider}/${model.id}`);

    // Tracing: turn this run into OTel spans. When the caller passed a
    // traceparent, invoke_agent nests under their /invoke span so the whole
    // agent run is part of the same trace (just like completion/chat).
    const otel = createAgentaOtel({
      traceparent: request.trace?.traceparent,
      baggage: request.trace?.baggage,
      endpoint: request.trace?.endpoint,
      authorization: request.trace?.authorization,
      captureContent: request.trace?.captureContent,
    });

    // Inject AGENTS.md in memory and keep on-disk context files out of the run.
    const agentsMd = request.agentsMd?.trim();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      noContextFiles: true,
      appendSystemPromptOverride: () => [],
      agentsFilesOverride: () => ({
        agentsFiles: agentsMd
          ? [{ path: "/virtual/AGENTS.md", content: agentsMd }]
          : [],
      }),
      extensionFactories: [otel.register],
    });
    await loader.reload();

    // Build runnable tools from the resolved specs. Pi's allowlist gates custom
    // tools too, so their names must be in `tools` for the model to see them.
    const customTools = buildCustomTools(
      request.customTools ?? [],
      request.toolCallback,
    );
    const toolAllowlist = [
      ...(request.tools ?? []),
      ...customTools.map((tool) => tool.name),
    ];
    if (customTools.length > 0) {
      log(`custom tools: ${customTools.map((t) => t.name).join(", ")}`);
    }

    const { session } = await createAgentSession({
      cwd,
      model,
      authStorage,
      modelRegistry,
      tools: toolAllowlist,
      customTools,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory(),
      resourceLoader: loader,
    });

    // Hand the session id + model to the extension so spans carry them.
    otel.config.sessionId = session.sessionId;
    otel.config.provider = model.provider;
    otel.config.requestModel = model.id;

    // Accumulate streamed text as the primary output channel.
    let streamed = "";
    session.subscribe((event: any) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        streamed += event.assistantMessageEvent.delta ?? "";
      }
    });

    await session.prompt(prompt);

    const output = streamed.trim() || extractAssistantText(session.messages);
    const sessionId = session.sessionId;
    session.dispose();

    // Ship this run's trace before the result is returned (and before the CLI
    // process exits): invoke_agent has a remote parent, so the per-trace flush
    // is what exports it.
    await otel.flush();

    return {
      ok: true,
      output,
      sessionId,
      model: `${model.provider}/${model.id}`,
      traceId: otel.config.traceId,
    };
  } finally {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of the throwaway working dir
    }
  }
}
