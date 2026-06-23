/**
 * agenta-otel — a Pi extension that turns Pi's `pi.on(...)` lifecycle events into
 * OpenTelemetry spans and exports them (OTLP/HTTP protobuf) to Agenta.
 *
 * Span tree (one per user prompt):
 *   invoke_agent            (openinference.span.kind = AGENT)
 *     turn N                (CHAIN)
 *       chat <model>        (LLM)   — the provider request for that turn
 *       execute_tool <name> (TOOL)  — each tool the turn ran
 *
 * Agenta's OpenInference adapter types nodes off `openinference.span.kind`
 * (AGENT->agent, CHAIN->chain, LLM->chat, TOOL->tool) and `session.id` ->
 * `ag.session.id`. Token usage is emitted under BOTH the legacy
 * (`prompt_tokens`/`completion_tokens`) and current
 * (`input_tokens`/`output_tokens`) GenAI names so it maps regardless of which
 * Agenta adapter claims the span.
 *
 * Works two ways with the same file:
 *   - SDK: pass the default export to DefaultResourceLoader.extensionFactories,
 *     then call shutdownTracing() after the run to flush (see run.ts).
 *   - CLI: `pi -e ./agenta-otel.ts`; the session_shutdown handler flushes on exit.
 *
 * Config (read lazily so the runner can load .env first):
 *   AGENTA_HOST, AGENTA_API_KEY         — exporter endpoint + auth (required)
 *   PI_OTEL_CAPTURE_CONTENT=0           — disable prompt/response/tool I/O capture
 *   OTEL_SERVICE_NAME                   — resource service.name (default "pi-agent")
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  context,
  trace,
  SpanStatusCode,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import type {
  ReadableSpan,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/**
 * Buffer a trace's spans and export them in ONE OTLP batch when the root span
 * ends. Agenta computes cumulative (rolled-up) token/cost metrics per ingest
 * batch, so a trace split across batches (which BatchSpanProcessor does on its
 * timer for long runs) loses the root aggregation — the agent node would show
 * only the last turn's tokens/cost instead of the whole-run total.
 */
class TraceBatchProcessor implements SpanProcessor {
  private readonly buffers = new Map<string, ReadableSpan[]>();
  constructor(private readonly exporter: SpanExporter) {}
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;
    const spans = this.buffers.get(traceId) ?? [];
    spans.push(span);
    if (span.parentSpanId) {
      this.buffers.set(traceId, spans);
    } else {
      // Root span ended: all descendants ended earlier, so the trace is complete.
      this.buffers.delete(traceId);
      this.exporter.export(orderParentFirst(spans), () => {});
    }
  }
  forceFlush(): Promise<void> {
    const leftovers = [...this.buffers.values()].flat();
    this.buffers.clear();
    if (leftovers.length === 0) return Promise.resolve();
    return new Promise((resolve) =>
      this.exporter.export(orderParentFirst(leftovers), () => resolve()),
    );
  }
  shutdown(): Promise<void> {
    return this.forceFlush().then(() => this.exporter.shutdown());
  }
}

/**
 * Order spans parent-before-child (preorder DFS). Agenta stores timestamps at
 * millisecond resolution and builds its roll-up tree by sorting on start_time,
 * attaching a span only if its parent is already seen. Sibling events fired in
 * the same millisecond (agent_start/turn_start) would otherwise tie, and a
 * child sorted before its parent gets dropped from the cumulative tree. A
 * parent-first request order makes the backend's stable sort keep parents ahead
 * of children on ties.
 */
function orderParentFirst(spans: ReadableSpan[]): ReadableSpan[] {
  const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]));
  const childrenOf = new Map<string, ReadableSpan[]>();
  const roots: ReadableSpan[] = [];
  for (const s of spans) {
    const parentId = s.parentSpanId;
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(s);
      childrenOf.set(parentId, list);
    } else {
      roots.push(s);
    }
  }
  const ordered: ReadableSpan[] = [];
  const visit = (s: ReadableSpan) => {
    ordered.push(s);
    for (const child of childrenOf.get(s.spanContext().spanId) ?? []) visit(child);
  };
  roots.forEach(visit);
  // Any spans not reached (defensive) get appended so nothing is dropped.
  if (ordered.length !== spans.length) {
    const seen = new Set(ordered);
    for (const s of spans) if (!seen.has(s)) ordered.push(s);
  }
  return ordered;
}

/** Set by the runner before prompting so spans can carry session + model. */
export const runConfig: {
  sessionId?: string;
  provider?: string;
  requestModel?: string;
  /** Filled by the extension on agent_start so the runner can print/fetch the trace. */
  traceId?: string;
} = {};

let provider: NodeTracerProvider | undefined;
let captureContent = true;

function initTracing(): void {
  if (provider) return;

  const host = (process.env.AGENTA_HOST || "https://cloud.agenta.ai").replace(
    /\/+$/,
    "",
  );
  const apiKey = process.env.AGENTA_API_KEY || "";
  const url = `${host}/api/otlp/v1/traces`;
  captureContent = process.env.PI_OTEL_CAPTURE_CONTENT !== "0";

  if (!apiKey) {
    console.warn(
      "[agenta-otel] AGENTA_API_KEY is not set — the collector will reject spans with 401.",
    );
  }
  console.log(`[agenta-otel] exporting spans to ${url} (content capture: ${captureContent})`);

  const exporter = new OTLPTraceExporter({
    url,
    headers: { Authorization: `ApiKey ${apiKey}` },
    timeoutMillis: 10_000,
  });

  provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "pi-agent",
    }),
  });
  provider.addSpanProcessor(new TraceBatchProcessor(exporter));
  provider.register();
}

/** Flush and shut down the exporter. Call from the runner after a run completes. */
export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
    await provider.shutdown();
  } finally {
    provider = undefined;
  }
}

const tracer = () => trace.getTracer("agenta-pi-otel", "0.1.0");

// --- per-run span state (the POC runs one prompt at a time) ---
let agentSpan: Span | undefined;
let agentCtx: Context | undefined;
let pendingPrompt: string | undefined;
let currentTurn: { span: Span; ctx: Context; index?: number } | undefined;
let llmSpan: Span | undefined;
let lastContextMessages: any[] | undefined;
const toolSpans = new Map<string, Span>();

/** A string output → ag.data.outputs (any type is valid there). */
function setOutput(span: Span, value: unknown): void {
  if (!captureContent || value == null) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length > 0) span.setAttribute("output.value", text);
}

/**
 * ag.data.inputs must be a dict, so emit input.value as a JSON object string.
 * A non-object (raw string) would be relocated to ag.unsupported by Agenta.
 */
function setInputs(span: Span, obj: Record<string, unknown>): void {
  if (!captureContent) return;
  span.setAttribute("input.value", JSON.stringify(obj));
  span.setAttribute("input.mime_type", "application/json");
}

function oiRole(role: string): string {
  return role === "toolResult" ? "tool" : role; // user | assistant | system | tool
}

function messageText(msg: any): string {
  const c = msg?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

/**
 * Emit OpenInference structured messages so Agenta renders a proper message
 * thread. `llm.input_messages.*` -> ag.data.inputs.prompt.*,
 * `llm.output_messages.*` -> ag.data.outputs.completion.*.
 */
function emitMessages(span: Span, prefix: string, messages: any[]): void {
  if (!captureContent || !Array.isArray(messages)) return;
  messages.forEach((m, i) => {
    const base = `${prefix}.${i}.message`;
    span.setAttribute(`${base}.role`, oiRole(m.role));
    const text = messageText(m);
    if (text) span.setAttribute(`${base}.content`, text);
    if (m.role === "toolResult" && m.toolCallId)
      span.setAttribute(`${base}.tool_call_id`, m.toolCallId);
    if (Array.isArray(m.content)) {
      m.content
        .filter((b: any) => b?.type === "toolCall")
        .forEach((call: any, j: number) => {
          const tc = `${base}.tool_calls.${j}.tool_call`;
          if (call.id) span.setAttribute(`${tc}.id`, call.id);
          span.setAttribute(`${tc}.function.name`, call.name);
          span.setAttribute(
            `${tc}.function.arguments`,
            JSON.stringify(call.arguments ?? {}),
          );
        });
    }
  });
}

function toolResultText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("");
  }
  if (result.content) return toolResultText(result.content);
  return JSON.stringify(result);
}

function lastAssistantText(messages: any): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messageText(messages[i]);
  }
  return "";
}

/** Fill an LLM span from a finished assistant message (model, tokens, finish, output). */
function applyAssistant(span: Span, msg: any): void {
  if (msg.provider) span.setAttribute("gen_ai.system", msg.provider);
  if (msg.model) span.setAttribute("gen_ai.request.model", msg.model);
  if (msg.responseModel || msg.model)
    span.setAttribute("gen_ai.response.model", msg.responseModel ?? msg.model);
  if (msg.responseId) span.setAttribute("gen_ai.response.id", msg.responseId);
  if (msg.stopReason)
    span.setAttribute("gen_ai.response.finish_reasons", [String(msg.stopReason)]);

  const u = msg.usage;
  if (u) {
    // Current GenAI names (mapped by Agenta's logfire adapter) ...
    span.setAttribute("gen_ai.usage.input_tokens", u.input ?? 0);
    span.setAttribute("gen_ai.usage.output_tokens", u.output ?? 0);
    // ... and legacy names (mapped by Agenta's semconv.py). Emit both so token
    // usage is never silently dropped regardless of which adapter wins.
    span.setAttribute("gen_ai.usage.prompt_tokens", u.input ?? 0);
    span.setAttribute("gen_ai.usage.completion_tokens", u.output ?? 0);
    span.setAttribute(
      "gen_ai.usage.total_tokens",
      u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0),
    );
    if (u.cacheRead)
      span.setAttribute("gen_ai.usage.cache_read_input_tokens", u.cacheRead);
    if (u.cacheWrite)
      span.setAttribute("gen_ai.usage.cache_creation_input_tokens", u.cacheWrite);
    if (u.cost?.total != null) span.setAttribute("gen_ai.usage.cost", u.cost.total);
  }

  emitMessages(span, "llm.output_messages", [msg]);
  if (msg.stopReason === "error" || msg.errorMessage) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: msg.errorMessage });
  }
}

export default function agentaOtel(pi: ExtensionAPI): void {
  initTracing();
  const t = tracer();

  pi.on("before_agent_start", async (event: any) => {
    pendingPrompt = event?.prompt;
  });

  pi.on("agent_start", async () => {
    agentSpan = t.startSpan("invoke_agent");
    agentSpan.setAttribute("openinference.span.kind", "AGENT");
    agentSpan.setAttribute("gen_ai.operation.name", "invoke_agent");
    agentSpan.setAttribute("gen_ai.agent.name", "pi");
    if (runConfig.sessionId) {
      agentSpan.setAttribute("session.id", runConfig.sessionId);
      agentSpan.setAttribute("gen_ai.conversation.id", runConfig.sessionId);
    }
    setInputs(agentSpan, { prompt: pendingPrompt ?? "" });
    runConfig.traceId = agentSpan.spanContext().traceId;
    agentCtx = trace.setSpan(context.active(), agentSpan);
  });

  // The messages handed to the next LLM call — the chat span's input.
  pi.on("context", async (event: any) => {
    if (Array.isArray(event?.messages)) lastContextMessages = event.messages;
  });

  pi.on("turn_start", async (event: any) => {
    const parent = agentCtx ?? context.active();
    const name = event?.turnIndex != null ? `turn ${event.turnIndex}` : "turn";
    const span = t.startSpan(name, undefined, parent);
    span.setAttribute("openinference.span.kind", "CHAIN");
    if (event?.turnIndex != null) span.setAttribute("pi.turn.index", event.turnIndex);
    currentTurn = { span, ctx: trace.setSpan(parent, span), index: event?.turnIndex };
  });

  pi.on("before_provider_request", async (_event: any, ctx: any) => {
    const parent = currentTurn?.ctx ?? agentCtx ?? context.active();
    const modelId = runConfig.requestModel ?? ctx?.model?.id;
    const providerName = runConfig.provider ?? ctx?.model?.provider;
    llmSpan = t.startSpan(modelId ? `chat ${modelId}` : "chat", undefined, parent);
    llmSpan.setAttribute("openinference.span.kind", "LLM");
    llmSpan.setAttribute("gen_ai.operation.name", "chat");
    if (providerName) llmSpan.setAttribute("gen_ai.system", providerName);
    if (modelId) llmSpan.setAttribute("gen_ai.request.model", modelId);
    if (lastContextMessages) emitMessages(llmSpan, "llm.input_messages", lastContextMessages);
  });

  pi.on("message_end", async (event: any) => {
    const msg = event?.message;
    if (!msg || msg.role !== "assistant" || !llmSpan) return;
    applyAssistant(llmSpan, msg);
    llmSpan.end();
    llmSpan = undefined;
  });

  pi.on("tool_execution_start", async (event: any) => {
    const parent = currentTurn?.ctx ?? agentCtx ?? context.active();
    const name = event?.toolName ? `execute_tool ${event.toolName}` : "execute_tool";
    const span = t.startSpan(name, undefined, parent);
    span.setAttribute("openinference.span.kind", "TOOL");
    span.setAttribute("gen_ai.operation.name", "execute_tool");
    if (event?.toolName) span.setAttribute("gen_ai.tool.name", event.toolName);
    if (event?.toolCallId) span.setAttribute("gen_ai.tool.call.id", event.toolCallId);
    setInputs(span, (event?.args as Record<string, unknown>) ?? {});
    if (event?.toolCallId) toolSpans.set(event.toolCallId, span);
  });

  pi.on("tool_execution_end", async (event: any) => {
    const span = event?.toolCallId ? toolSpans.get(event.toolCallId) : undefined;
    if (!span) return;
    setOutput(span, toolResultText(event?.result));
    if (event?.isError) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    toolSpans.delete(event.toolCallId);
  });

  pi.on("turn_end", async (event: any) => {
    // Safety net: if the LLM span is still open (no assistant message_end seen),
    // close it from the turn's assistant message.
    if (llmSpan && event?.message) {
      applyAssistant(llmSpan, event.message);
      llmSpan.end();
      llmSpan = undefined;
    }
    if (currentTurn) {
      currentTurn.span.end();
      currentTurn = undefined;
    }
  });

  pi.on("agent_end", async (event: any) => {
    if (!agentSpan) return;
    setOutput(agentSpan, lastAssistantText(event?.messages));
    agentSpan.end();
    agentSpan = undefined;
    agentCtx = undefined;
    lastContextMessages = undefined;
  });

  // CLI (`pi -e`) flush path. The SDK runner additionally calls shutdownTracing().
  pi.on("session_shutdown", async () => {
    try {
      await provider?.forceFlush();
    } catch {
      /* best effort */
    }
  });
}
