/**
 * WP-2 Pi harness driver.
 *
 * This is the concrete "harness" behind the service's Harness port. It drives the
 * Pi SDK (`createAgentSession`) for a single run: it injects the agent's AGENTS.md
 * in memory, resolves the model, sends one user turn, and returns the final
 * assistant text. No streaming, no tools by default, no session persistence. Those
 * are later work packages.
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

export interface AgentRunRequest {
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

    const { session } = await createAgentSession({
      cwd,
      model,
      authStorage,
      modelRegistry,
      tools: request.tools ?? [],
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
