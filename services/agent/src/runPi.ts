/**
 * Legacy backend: drive the Pi SDK in-process for one cold run.
 *
 * This is the non-rivet engine. It drives Pi's `createAgentSession` directly: injects
 * AGENTS.md in memory, resolves the model, sends one user turn, and returns the structured
 * result (final text, messages, events, usage, capabilities). It also turns the
 * backend-resolved runnable tools (WP-7) into Pi customTools that route back through
 * Agenta's /tools/call. The rivet backend (`runRivet.ts`) is the ACP path; both serve the
 * same `/run` contract (see `protocol.ts`).
 *
 * Auth: provider keys arrive as `request.secrets` (applied to the env) or fall back to the
 * local Pi login (`AuthStorage.create()` reads ~/.pi/agent/auth.json). Nothing
 * invocation-specific is written to a persistent disk: the session is in-memory and the
 * working dir is a throwaway temp dir.
 *
 * Important: stdout is reserved for the JSON result (see cli.ts). Everything here logs to
 * stderr so it never pollutes the result channel.
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
import {
  type AgentEvent,
  type AgentRunRequest,
  type AgentRunResult,
  type ChatMessage,
  type HarnessCapabilities,
  type ResolvedToolSpec,
  type ToolCallbackContext,
  resolvePromptText,
} from "./protocol.ts";
import { EMPTY_OBJECT_SCHEMA, callAgentaTool } from "./toolClient.ts";

/** What the in-process Pi engine supports. Static (no daemon to probe, unlike rivet). */
const PI_CAPABILITIES: HarnessCapabilities = {
  textMessages: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  streamingDeltas: true,
  images: false,
  fileAttachments: false,
  mcpTools: false,
  planMode: false,
  permissions: false,
  sessionLifecycle: false,
};

function log(message: string): void {
  process.stderr.write(`[pi-wrapper] ${message}\n`);
}

/** Apply vault-resolved provider keys to the process env so Pi's model auth can see them. */
function applySecrets(secrets: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(secrets ?? {})) {
    if (value) process.env[key] = value;
  }
}

/** Pick the requested model, else gpt-5.5, else a sensible non-mini default. */
function pickModel(available: any[], wanted?: string): any {
  return (
    (wanted &&
      available.find((m) => m.id === wanted || `${m.provider}/${m.id}` === wanted)) ||
    available.find((m) => m.id === "gpt-5.5") ||
    available.find((m) => !/spark|mini/i.test(m.id)) ||
    available[0]
  );
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

/** The stop reason of the last assistant message, when Pi set one. */
function lastStopReason(messages: any[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant" && messages[i].stopReason) {
      return String(messages[i].stopReason);
    }
  }
  return undefined;
}

/**
 * Turn resolved tool specs into Pi customTools. Each tool's `execute` does one POST back
 * through Agenta's /tools/call, so Pi runs the loop while the Composio key and connection
 * auth stay server-side. A failed call throws, which Pi turns into a tool-error result
 * (the loop continues) rather than a run failure.
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
    // Pi accepts a plain JSON Schema for `parameters` (its validator has a non-TypeBox
    // path); the schema is resolved live from the provider catalog.
    parameters: (spec.inputSchema as any) ?? EMPTY_OBJECT_SCHEMA,
    async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
      const text = await callAgentaTool(
        callback.endpoint,
        callback.authorization,
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

export async function runPi(request: AgentRunRequest): Promise<AgentRunResult> {
  const prompt = resolvePromptText(request);
  if (!prompt) {
    return { ok: false, error: "No user message to send (prompt/messages empty)." };
  }

  applySecrets(request.secrets);
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

    // Tracing: turn this run into OTel spans. When the caller passed a traceparent,
    // invoke_agent nests under their /invoke span so the whole agent run is part of the
    // same trace (just like completion/chat).
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

    // Build runnable tools from the resolved specs. Pi's allowlist gates custom tools too,
    // so their names must be in `tools` for the model to see them.
    const customTools = buildCustomTools(request.customTools ?? [], request.toolCallback);
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
    const stopReason = lastStopReason(session.messages);
    const usage = otel.usage();
    session.dispose();

    // Ship this run's trace before the result is returned (and before the CLI process
    // exits): invoke_agent has a remote parent, so the per-trace flush is what exports it.
    await otel.flush();

    // The structured stream is thinner here than on the rivet path: Pi's in-process tool
    // events feed the trace spans, while the result-level event log carries the final
    // message, usage, and stop reason (enough for the platform without double-plumbing).
    const events: AgentEvent[] = [];
    if (output) events.push({ type: "message", text: output });
    if (usage.total > 0) {
      events.push({ type: "usage", ...usage });
    }
    events.push({ type: "done", stopReason });

    const messages: ChatMessage[] = output
      ? [{ role: "assistant", content: output }]
      : [];

    return {
      ok: true,
      output,
      messages,
      events,
      usage,
      stopReason,
      capabilities: PI_CAPABILITIES,
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
