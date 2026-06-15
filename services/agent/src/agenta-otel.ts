/**
 * agenta-otel — a Pi extension that turns Pi's `pi.on(...)` lifecycle events into
 * OpenTelemetry spans and exports them (OTLP/HTTP protobuf) to Agenta.
 *
 * This is the service build of the WP-1 POC extension
 * (docs/design/agent-workflows/wp-1-pi-tracing/poc/agenta-otel.ts). It keeps the
 * span tree and the load-bearing attribute choices identical, and adds three
 * things the service needs that the single-run POC did not:
 *
 *   1. Per-run state. The POC kept span state in module globals because it ran one
 *      prompt at a time. The service may drive several runs in one process (the
 *      HTTP sidecar), so all per-run state lives in the closure returned by
 *      `createAgentaOtel`. The shared tracer/provider/exporters stay module-level.
 *   2. Cross-boundary trace context. The caller (the Agenta Python service) passes a
 *      W3C `traceparent`. When present, `invoke_agent` is started as a CHILD of that
 *      remote span, so the whole agent run joins the same trace as the `/invoke`
 *      request — the agent's work becomes part of the response trace, the way
 *      completion/chat nest their LLM spans under the workflow span.
 *   3. Per-trace export target. The OTLP endpoint and `Authorization` header come
 *      from the run config (the caller's host + credentials), falling back to env.
 *      Each trace is exported with its own target, so a shared process can serve
 *      more than one project.
 *
 * Span tree (per user prompt), unchanged from the POC:
 *   invoke_agent            (openinference.span.kind = AGENT)
 *     turn N                (CHAIN)
 *       chat <model>        (LLM)   — the provider request for that turn
 *       execute_tool <name> (TOOL)  — each tool the turn ran
 *
 * Config (read lazily from the environment for the fallback target):
 *   AGENTA_HOST, AGENTA_API_KEY  — fallback exporter endpoint + auth
 *   OTEL_SERVICE_NAME            — resource service.name (default "pi-agent")
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  context,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  SpanStatusCode,
  type Context,
  type Span,
  type SpanContext,
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

// ---------------------------------------------------------------------------
// Shared, process-wide tracing infrastructure
// ---------------------------------------------------------------------------

/** Where a trace's spans are shipped: an OTLP endpoint and an Authorization header. */
interface ExportTarget {
  endpoint: string;
  authorization?: string;
}

/** traceId (hex) -> where that trace's spans should be exported. Set on agent_start. */
const traceTargets = new Map<string, ExportTarget>();

/** Cache one exporter per distinct endpoint+auth so we do not rebuild per export. */
const exporterCache = new Map<string, OTLPTraceExporter>();

function targetKey(target: ExportTarget): string {
  return `${target.endpoint}\n${target.authorization ?? ""}`;
}

function getExporter(target: ExportTarget): OTLPTraceExporter {
  const key = targetKey(target);
  let exporter = exporterCache.get(key);
  if (!exporter) {
    exporter = new OTLPTraceExporter({
      url: target.endpoint,
      headers: target.authorization
        ? { Authorization: target.authorization }
        : {},
      timeoutMillis: 10_000,
    });
    exporterCache.set(key, exporter);
  }
  return exporter;
}

/** Fallback target from env, used when a trace was started without an explicit one. */
function defaultTarget(): ExportTarget {
  const host = (process.env.AGENTA_HOST || "https://cloud.agenta.ai").replace(
    /\/+$/,
    "",
  );
  const apiKey = process.env.AGENTA_API_KEY || "";
  return {
    endpoint: `${host}/api/otlp/v1/traces`,
    authorization: apiKey ? `ApiKey ${apiKey}` : undefined,
  };
}

/**
 * Buffer a trace's spans and export them in ONE OTLP batch. Agenta computes
 * cumulative (rolled-up) token/cost metrics per ingest batch, so a trace split
 * across batches loses the root aggregation. Two completion signals:
 *   - the root span ends (standalone run: invoke_agent IS the root), or
 *   - the run flushes explicitly by trace id (cross-boundary run: invoke_agent
 *     has a remote parent that never ends in this process, so root-end never fires).
 */
class TraceBatchProcessor implements SpanProcessor {
  private readonly buffers = new Map<string, ReadableSpan[]>();

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;
    const spans = this.buffers.get(traceId) ?? [];
    spans.push(span);
    this.buffers.set(traceId, spans);
    // No parent in this process => this is the local root and the trace is done.
    if (!span.parentSpanId) {
      this.flush(traceId);
    }
  }

  /** Export and drop one trace's buffered spans. Resolves once the export returns. */
  flush(traceId: string): Promise<void> {
    const spans = this.buffers.get(traceId);
    if (!spans || spans.length === 0) return Promise.resolve();
    this.buffers.delete(traceId);
    const target = traceTargets.get(traceId) ?? defaultTarget();
    traceTargets.delete(traceId);
    return new Promise((resolve) =>
      getExporter(target).export(orderParentFirst(spans), () => resolve()),
    );
  }

  forceFlush(): Promise<void> {
    return Promise.all(
      [...this.buffers.keys()].map((traceId) => this.flush(traceId)),
    ).then(() => undefined);
  }

  shutdown(): Promise<void> {
    return this.forceFlush().then(async () => {
      await Promise.all(
        [...exporterCache.values()].map((exporter) => exporter.shutdown()),
      );
    });
  }
}

let provider: NodeTracerProvider | undefined;
let processor: TraceBatchProcessor | undefined;

function ensureProvider(): void {
  if (provider) return;
  processor = new TraceBatchProcessor();
  provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "pi-agent",
    }),
  });
  provider.addSpanProcessor(processor);
  provider.register();
}

/** Flush one trace's spans to Agenta. Call after a run whose root has a remote parent. */
export async function flushTrace(traceId?: string): Promise<void> {
  if (!processor || !traceId) return;
  await processor.flush(traceId);
}

/** Flush and shut down all exporters. Call once on process exit, not per run. */
export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
    await provider.shutdown();
  } finally {
    provider = undefined;
    processor = undefined;
    exporterCache.clear();
  }
}

/**
 * Order spans parent-before-child (preorder DFS). Agenta stores timestamps at
 * millisecond resolution and builds its roll-up tree by sorting on start_time,
 * attaching a span only if its parent is already seen. A parent-first request
 * order keeps parents ahead of children on same-millisecond ties.
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

/** Build a parent Context from a W3C traceparent string, or undefined if absent/invalid. */
function parentContext(traceparent?: string): Context | undefined {
  if (!traceparent) return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
    traceparent.trim(),
  );
  if (!match) return undefined;
  const [, traceId, spanId, flags] = match;
  const spanContext: SpanContext = {
    traceId,
    spanId,
    // Honor the incoming sampled bit; default to sampled so child spans record.
    traceFlags: (parseInt(flags, 16) & 1) === 1 ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
  return trace.setSpanContext(ROOT_CONTEXT, spanContext);
}

// ---------------------------------------------------------------------------
// Per-run config + content helpers
// ---------------------------------------------------------------------------

/** One run's tracing config. Mutated by the runner after the session is created. */
export interface RunConfig {
  /** OTLP traces endpoint for this run's trace (falls back to env). */
  endpoint?: string;
  /** Authorization header value for the OTLP export (falls back to env ApiKey). */
  authorization?: string;
  /** W3C traceparent from the caller; nests invoke_agent under that span. */
  traceparent?: string;
  /** Drop prompt/completion/tool I/O from spans when false. */
  captureContent: boolean;
  /** Pi session id, set after createAgentSession so spans carry session.id. */
  sessionId?: string;
  /** Resolved provider, set after the model is picked. */
  provider?: string;
  /** Resolved model id, set after the model is picked. */
  requestModel?: string;
  /** Filled by the extension on agent_start so the runner can flush/return it. */
  traceId?: string;
}

/** A string output → ag.data.outputs (any type is valid there). */
function setOutput(span: Span, value: unknown, capture: boolean): void {
  if (!capture || value == null) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length > 0) span.setAttribute("output.value", text);
}

/**
 * ag.data.inputs must be a dict, so emit input.value as a JSON object string.
 * A non-object (raw string) would be relocated to ag.unsupported by Agenta.
 */
function setInputs(
  span: Span,
  obj: Record<string, unknown>,
  capture: boolean,
): void {
  if (!capture) return;
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
function emitMessages(
  span: Span,
  prefix: string,
  messages: any[],
  capture: boolean,
): void {
  if (!capture || !Array.isArray(messages)) return;
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
function applyAssistant(span: Span, msg: any, capture: boolean): void {
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

  emitMessages(span, "llm.output_messages", [msg], capture);
  if (msg.stopReason === "error" || msg.errorMessage) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: msg.errorMessage });
  }
}

// ---------------------------------------------------------------------------
// Extension factory (one per run; state is closure-scoped)
// ---------------------------------------------------------------------------

export interface AgentaOtel {
  /** Register with DefaultResourceLoader.extensionFactories. */
  register: (pi: ExtensionAPI) => void;
  /** Mutable config; set sessionId/provider/requestModel after the session exists. */
  config: RunConfig;
  /** Flush this run's trace to Agenta. Await before the process/response ends. */
  flush: () => Promise<void>;
}

/**
 * Build a tracing extension scoped to a single agent run. Pass `register` to the
 * resource loader, fill in `config.sessionId`/`provider`/`requestModel` once the
 * session and model are resolved, then `await flush()` after the prompt completes.
 */
export function createAgentaOtel(
  init: Partial<RunConfig> & { captureContent?: boolean },
): AgentaOtel {
  ensureProvider();

  const config: RunConfig = {
    endpoint: init.endpoint,
    authorization: init.authorization,
    traceparent: init.traceparent,
    captureContent: init.captureContent !== false,
    sessionId: init.sessionId,
    provider: init.provider,
    requestModel: init.requestModel,
  };

  const tracer = trace.getTracer("agenta-pi-otel", "0.1.0");

  // Per-run span state — closure-scoped so concurrent runs never collide.
  let agentSpan: Span | undefined;
  let agentCtx: Context | undefined;
  let pendingPrompt: string | undefined;
  let currentTurn: { span: Span; ctx: Context; index?: number } | undefined;
  let llmSpan: Span | undefined;
  let lastContextMessages: any[] | undefined;
  const toolSpans = new Map<string, Span>();

  const register = (pi: ExtensionAPI): void => {
    pi.on("before_agent_start", async (event: any) => {
      pendingPrompt = event?.prompt;
    });

    pi.on("agent_start", async () => {
      // Nest under the caller's workflow span when a traceparent was supplied,
      // so the whole run joins the /invoke trace; otherwise start a fresh root.
      const parent = parentContext(config.traceparent);
      agentSpan = tracer.startSpan("invoke_agent", undefined, parent);
      agentSpan.setAttribute("openinference.span.kind", "AGENT");
      agentSpan.setAttribute("gen_ai.operation.name", "invoke_agent");
      agentSpan.setAttribute("gen_ai.agent.name", "pi");
      if (config.sessionId) {
        agentSpan.setAttribute("session.id", config.sessionId);
        agentSpan.setAttribute("gen_ai.conversation.id", config.sessionId);
      }
      setInputs(agentSpan, { prompt: pendingPrompt ?? "" }, config.captureContent);

      const traceId = agentSpan.spanContext().traceId;
      config.traceId = traceId;
      traceTargets.set(traceId, {
        endpoint: config.endpoint ?? defaultTarget().endpoint,
        authorization: config.authorization ?? defaultTarget().authorization,
      });
      agentCtx = trace.setSpan(parent ?? context.active(), agentSpan);
    });

    // The messages handed to the next LLM call — the chat span's input.
    pi.on("context", async (event: any) => {
      if (Array.isArray(event?.messages)) lastContextMessages = event.messages;
    });

    pi.on("turn_start", async (event: any) => {
      const parent = agentCtx ?? context.active();
      const name = event?.turnIndex != null ? `turn ${event.turnIndex}` : "turn";
      const span = tracer.startSpan(name, undefined, parent);
      span.setAttribute("openinference.span.kind", "CHAIN");
      if (event?.turnIndex != null) span.setAttribute("pi.turn.index", event.turnIndex);
      currentTurn = { span, ctx: trace.setSpan(parent, span), index: event?.turnIndex };
    });

    pi.on("before_provider_request", async (_event: any, ctx: any) => {
      const parent = currentTurn?.ctx ?? agentCtx ?? context.active();
      const modelId = config.requestModel ?? ctx?.model?.id;
      const providerName = config.provider ?? ctx?.model?.provider;
      llmSpan = tracer.startSpan(modelId ? `chat ${modelId}` : "chat", undefined, parent);
      llmSpan.setAttribute("openinference.span.kind", "LLM");
      llmSpan.setAttribute("gen_ai.operation.name", "chat");
      if (providerName) llmSpan.setAttribute("gen_ai.system", providerName);
      if (modelId) llmSpan.setAttribute("gen_ai.request.model", modelId);
      if (lastContextMessages)
        emitMessages(llmSpan, "llm.input_messages", lastContextMessages, config.captureContent);
    });

    pi.on("message_end", async (event: any) => {
      const msg = event?.message;
      if (!msg || msg.role !== "assistant" || !llmSpan) return;
      applyAssistant(llmSpan, msg, config.captureContent);
      llmSpan.end();
      llmSpan = undefined;
    });

    pi.on("tool_execution_start", async (event: any) => {
      const parent = currentTurn?.ctx ?? agentCtx ?? context.active();
      const name = event?.toolName ? `execute_tool ${event.toolName}` : "execute_tool";
      const span = tracer.startSpan(name, undefined, parent);
      span.setAttribute("openinference.span.kind", "TOOL");
      span.setAttribute("gen_ai.operation.name", "execute_tool");
      if (event?.toolName) span.setAttribute("gen_ai.tool.name", event.toolName);
      if (event?.toolCallId) span.setAttribute("gen_ai.tool.call.id", event.toolCallId);
      setInputs(span, (event?.args as Record<string, unknown>) ?? {}, config.captureContent);
      if (event?.toolCallId) toolSpans.set(event.toolCallId, span);
    });

    pi.on("tool_execution_end", async (event: any) => {
      const span = event?.toolCallId ? toolSpans.get(event.toolCallId) : undefined;
      if (!span) return;
      setOutput(span, toolResultText(event?.result), config.captureContent);
      if (event?.isError) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      toolSpans.delete(event.toolCallId);
    });

    pi.on("turn_end", async (event: any) => {
      // Safety net: if the LLM span is still open (no assistant message_end seen),
      // close it from the turn's assistant message.
      if (llmSpan && event?.message) {
        applyAssistant(llmSpan, event.message, config.captureContent);
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
      setOutput(agentSpan, lastAssistantText(event?.messages), config.captureContent);
      agentSpan.end();
      agentSpan = undefined;
      agentCtx = undefined;
      lastContextMessages = undefined;
    });
  };

  return {
    register,
    config,
    flush: () => flushTrace(config.traceId),
  };
}
