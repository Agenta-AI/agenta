/**
 * agenta-otel — a Pi extension that turns Pi's `pi.on(...)` lifecycle events into
 * OpenTelemetry spans and exports them (OTLP/HTTP protobuf) to Agenta.
 *
 * This is the service build of the WP-1 POC extension
 * (docs/design/agent-workflows/scratch/wp-1-pi-tracing/poc/agenta-otel.ts). It keeps the
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

import type { AgentEvent, AgentUsage, EmitEvent } from "../protocol.ts";

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
  /** W3C baggage from the caller (carried for future use). */
  baggage?: string;
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
  /** Run totals (tokens + cost) summed across turns, for roll-up onto the parent. */
  usage: () => { input: number; output: number; total: number; cost: number };
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
  // Run totals, summed across every assistant turn. Stamped on the agent span and
  // returned so the caller can roll them up onto the workflow span in its own process
  // (the agent and workflow spans are exported in separate OTLP batches, so Agenta's
  // per-batch cumulative roll-up cannot bridge them on its own).
  const runUsage = { input: 0, output: 0, total: 0, cost: 0 };

  function accumulateUsage(msg: any): void {
    const u = msg?.usage;
    if (!u) return;
    const input = u.input ?? 0;
    const output = u.output ?? 0;
    runUsage.input += input;
    runUsage.output += output;
    runUsage.total += u.totalTokens ?? input + output;
    if (u.cost?.total != null) runUsage.cost += u.cost.total;
  }

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
      accumulateUsage(msg);
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
        accumulateUsage(event.message);
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
      // Stamp the run total on the agent span so it shows the agent's tokens/cost even
      // though Agenta cannot roll the per-turn LLM spans up across batches.
      if (runUsage.total > 0) {
        agentSpan.setAttribute("gen_ai.usage.input_tokens", runUsage.input);
        agentSpan.setAttribute("gen_ai.usage.output_tokens", runUsage.output);
        agentSpan.setAttribute("gen_ai.usage.prompt_tokens", runUsage.input);
        agentSpan.setAttribute("gen_ai.usage.completion_tokens", runUsage.output);
        agentSpan.setAttribute("gen_ai.usage.total_tokens", runUsage.total);
        if (runUsage.cost > 0) agentSpan.setAttribute("gen_ai.usage.cost", runUsage.cost);
      }
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
    usage: () => ({ ...runUsage }),
  };
}

// ---------------------------------------------------------------------------
// sandbox-agent / ACP tracer (one per run; state is closure-scoped)
// ---------------------------------------------------------------------------
//
// The Pi extension above hooks Pi's in-process `pi.on(...)` events. Under sandbox-agent the
// harness runs as a separate process and we never see those events; instead the sandbox-agent
// SDK surfaces the run as ACP `session/update` notifications (agent_message_chunk,
// tool_call, tool_call_update, usage_update). This tracer builds the SAME span tree
// from that event stream, so tracing is uniform across every harness sandbox-agent drives
// (Pi, Claude Code, ...) and always nests under the caller's `/invoke` span.
//
// Span tree (per prompt turn):
//   invoke_agent          (AGENT)
//     turn 0              (CHAIN)
//       chat <model>      (LLM)   — model interaction; usage where the harness reports it
//       execute_tool <n>  (TOOL)  — one per ACP tool_call

/** Text of an ACP ContentBlock (the shape carried by message/thought chunks). */
function acpBlockText(block: any): string {
  if (!block) return "";
  if (typeof block === "string") return block;
  if (block.type === "text" && typeof block.text === "string") return block.text;
  return "";
}

/** Text of an ACP tool_call `content` array (ToolCallContent[]). */
function acpToolContentText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => acpBlockText(c?.content ?? c))
      .filter(Boolean)
      .join("");
  }
  return "";
}

/**
 * Strip the pi-acp startup banner that some setups emit as the first agent message
 * chunk (a "pi vX.Y.Z" / "## Context" / file list / "New version available" prelude,
 * surfaced ahead of the real answer). Removes only a leading run of those marker lines
 * so a genuine answer is never touched.
 */
function stripStartupBanner(text: string): string {
  const lines = text.split("\n");
  const isBanner = (line: string) =>
    /^pi v\d+\.\d+\.\d+/.test(line) ||
    /^## Context\b/.test(line) ||
    /^-\s+\/.*AGENTS\.md\s*$/.test(line) ||
    /^New version available:/.test(line) ||
    /^Run: `npm/.test(line) ||
    line.trim() === "---" ||
    line.trim() === "";
  let i = 0;
  let sawBanner = false;
  while (i < lines.length && isBanner(lines[i])) {
    if (lines[i].trim() !== "") sawBanner = true;
    i++;
  }
  return sawBanner ? lines.slice(i).join("\n").trim() : text;
}

/** Split a resolved model id ("openai-codex/gpt-5.5") into provider + id. */
function splitModel(model?: string): { provider?: string; id?: string } {
  if (!model) return {};
  const slash = model.indexOf("/");
  if (slash === -1) return { id: model };
  return { provider: model.slice(0, slash), id: model.slice(slash + 1) };
}

export interface SandboxAgentOtelInit extends Partial<RunConfig> {
  captureContent?: boolean;
  /** Harness id ("pi" / "claude"); becomes gen_ai.agent.name. */
  harness?: string;
  /** Resolved model id ("openai-codex/gpt-5.5"); set on the LLM span. */
  model?: string;
  /**
   * Emit the span tree from the ACP event stream. Default true. Set false when the
   * harness instruments itself (e.g. Pi via the agenta extension propagates the trace
   * context and emits its own real turn/chat/tool spans) — then this only accumulates
   * the reply text and builds no spans, so the two do not double up.
   */
  emitSpans?: boolean;
  /**
   * Live event sink. When set, each `AgentEvent` is flushed here the moment it is built
   * (in addition to being recorded in `events[]`), and the text/reasoning blocks are
   * emitted as `*_start`/`*_delta`/`*_end` lifecycle events rather than coalesced at the
   * end. When unset (the one-shot path), only the coalesced `message`/`thought` land in
   * `events[]`. This split is what keeps a delta'd block from being re-sent in full.
   */
  emit?: EmitEvent;
}

export interface SandboxAgentOtel {
  /** Start the invoke_agent (AGENT) span as a child of the caller's traceparent. */
  start(input: { prompt?: string; messages?: any[]; sessionId?: string }): void;
  /** Feed one ACP `session/update` payload (the `update` object). */
  handleUpdate(update: any): void;
  /**
   * Record an event the ACP stream does not carry (e.g. an `interaction_request` raised via
   * the permission callback). Routes through the same choke point as stream events, so it
   * lands in both the live sink and the batch `events()` log in build order.
   */
  emitEvent(event: AgentEvent): void;
  /** End all open spans. Returns the accumulated assistant text. */
  finish(): string;
  /** Set final run usage before finish/flush so events and exported spans carry final totals. */
  setUsage(usage: AgentUsage | undefined): void;
  /** Flush this run's trace to Agenta (invoke_agent has a remote parent). */
  flush(): Promise<void>;
  /** Trace id of the run (the caller's trace when a traceparent was passed). */
  traceId(): string | undefined;
  /** Accumulated assistant output text so far. */
  output(): string;
  /** The structured event log built from the ACP stream (tool calls, usage, final message). */
  events(): AgentEvent[];
  /** Run token/cost totals from the stream, when the harness reported `usage_update`. */
  usage(): AgentUsage | undefined;
}

/**
 * Build an ACP-event-driven tracer scoped to a single sandbox-agent run. Call `start` once,
 * `handleUpdate` for every ACP session update, then `finish` + `await flush`.
 */
export function createSandboxAgentOtel(init: SandboxAgentOtelInit): SandboxAgentOtel {
  ensureProvider();

  const capture = init.captureContent !== false;
  const emitSpans = init.emitSpans !== false;
  const endpoint = init.endpoint ?? defaultTarget().endpoint;
  const authorization = init.authorization ?? defaultTarget().authorization;
  const { provider, id: modelId } = splitModel(init.model);
  const tracer = trace.getTracer("agenta-sandbox-agent-otel", "0.1.0");

  let agentSpan: Span | undefined;
  let agentCtx: Context | undefined;
  let turnSpan: Span | undefined;
  let turnCtx: Context | undefined;
  let llmSpan: Span | undefined;
  let runTraceId: string | undefined;
  let accumulated = "";
  let reasoningAccumulated = "";
  let usage: AgentUsage | undefined;
  const events: AgentEvent[] = [];
  const toolSpans = new Map<string, { span?: Span; name: string }>();

  // Live emission. `record` is the single choke point for every event: it appends to the
  // result log and, on the streaming path, flushes the event the moment it is built — so
  // the live order is byte-identical to `events[]`. A sink failure never aborts the run.
  const sink = init.emit;
  function record(event: AgentEvent): void {
    events.push(event);
    if (sink) {
      try {
        sink(event);
      } catch {
        // a downstream sink error must not break the agent run
      }
    }
  }

  function stampUsage(span: Span, u: AgentUsage | undefined): void {
    if (!u) return;
    span.setAttribute("gen_ai.usage.input_tokens", u.input);
    span.setAttribute("gen_ai.usage.output_tokens", u.output);
    span.setAttribute("gen_ai.usage.prompt_tokens", u.input);
    span.setAttribute("gen_ai.usage.completion_tokens", u.output);
    span.setAttribute("gen_ai.usage.total_tokens", u.total);
    if (u.cost > 0) span.setAttribute("gen_ai.usage.cost", u.cost);
  }

  function setUsage(finalUsage: AgentUsage | undefined): void {
    if (!finalUsage) return;
    usage = finalUsage;
    const event: AgentEvent = { type: "usage", ...finalUsage };
    if (!sink) {
      const index = events.findLastIndex((e) => e.type === "usage");
      if (index !== -1) {
        events[index] = event;
        return;
      }
    }
    record(event);
  }

  // Text/reasoning block lifecycle (streaming path only). At most one block of each kind is
  // open; each gets a stable, monotonic id. `*Emitted` tracks the total text delivered as
  // deltas across the whole run (NOT per block) — `accumulated` is run-long, so the next
  // delta is always its remainder. Block boundaries (a tool call between two text runs) only
  // insert start/end markers; they must not reset the counter, or the second block would
  // re-emit the first block's text.
  let textBlockId: string | undefined;
  let textEmitted = "";
  let anyTextDelta = false;
  let reasoningBlockId: string | undefined;
  let reasoningEmitted = "";
  let blockSeq = 0;
  const nextId = (prefix: string): string => `${prefix}-${blockSeq++}`;

  function closeText(): void {
    if (textBlockId === undefined) return;
    record({ type: "message_end", id: textBlockId });
    textBlockId = undefined;
  }

  function closeReasoning(): void {
    if (reasoningBlockId === undefined) return;
    record({ type: "reasoning_end", id: reasoningBlockId });
    reasoningBlockId = undefined;
  }

  /** Open (if needed) the assistant text block and emit the pure delta up to `target`. */
  function streamText(target: string): void {
    closeReasoning(); // a text chunk ends any open reasoning run (blocks never overlap)
    const delta = target.startsWith(textEmitted)
      ? target.slice(textEmitted.length)
      : target;
    if (!delta) return;
    if (textBlockId === undefined) {
      textBlockId = nextId("msg");
      record({ type: "message_start", id: textBlockId });
    }
    record({ type: "message_delta", id: textBlockId, delta });
    textEmitted = target.startsWith(textEmitted) ? target : textEmitted + delta;
    anyTextDelta = true;
  }

  /** Open (if needed) the reasoning block and emit the pure delta up to `target`. */
  function streamReasoning(target: string): void {
    closeText(); // a reasoning chunk ends any open text run
    const delta = target.startsWith(reasoningEmitted)
      ? target.slice(reasoningEmitted.length)
      : target;
    if (!delta) return;
    if (reasoningBlockId === undefined) {
      reasoningBlockId = nextId("reason");
      record({ type: "reasoning_start", id: reasoningBlockId });
    }
    record({ type: "reasoning_delta", id: reasoningBlockId, delta });
    reasoningEmitted = target.startsWith(reasoningEmitted) ? target : reasoningEmitted + delta;
  }

  function start(input: { prompt?: string; messages?: any[]; sessionId?: string }): void {
    // Span-less mode (harness self-instruments): only track the trace id so the run can
    // report it; the harness emits the spans under the propagated parent.
    if (!emitSpans) {
      const m = /^00-([0-9a-f]{32})-/.exec(init.traceparent ?? "");
      runTraceId = m ? m[1] : undefined;
      return;
    }
    const parent = parentContext(init.traceparent);
    agentSpan = tracer.startSpan("invoke_agent", undefined, parent);
    agentSpan.setAttribute("openinference.span.kind", "AGENT");
    agentSpan.setAttribute("gen_ai.operation.name", "invoke_agent");
    agentSpan.setAttribute("gen_ai.agent.name", init.harness ?? "agent");
    const sessionId = input.sessionId ?? init.sessionId;
    if (sessionId) {
      agentSpan.setAttribute("session.id", sessionId);
      agentSpan.setAttribute("gen_ai.conversation.id", sessionId);
    }
    setInputs(agentSpan, { prompt: input.prompt ?? "" }, capture);

    runTraceId = agentSpan.spanContext().traceId;
    traceTargets.set(runTraceId, { endpoint, authorization });
    agentCtx = trace.setSpan(parent ?? context.active(), agentSpan);

    turnSpan = tracer.startSpan("turn 0", undefined, agentCtx);
    turnSpan.setAttribute("openinference.span.kind", "CHAIN");
    turnSpan.setAttribute("pi.turn.index", 0);
    turnCtx = trace.setSpan(agentCtx, turnSpan);

    llmSpan = tracer.startSpan(modelId ? `chat ${modelId}` : "chat", undefined, turnCtx);
    llmSpan.setAttribute("openinference.span.kind", "LLM");
    llmSpan.setAttribute("gen_ai.operation.name", "chat");
    if (provider) llmSpan.setAttribute("gen_ai.system", provider);
    if (modelId) llmSpan.setAttribute("gen_ai.request.model", modelId);
    const inputMessages =
      input.messages && input.messages.length
        ? input.messages
        : [{ role: "user", content: input.prompt ?? "" }];
    emitMessages(llmSpan, "llm.input_messages", inputMessages, capture);
  }

  function handleUpdate(update: any): void {
    const kind = update?.sessionUpdate;
    if (!kind) return;

    if (kind === "agent_message_chunk") {
      const t = acpBlockText(update.content);
      if (!t) return;
      // Pi streams pure deltas; Claude streams deltas plus a cumulative snapshot.
      // Replace when a chunk is a superset of what we have, append otherwise.
      if (t.startsWith(accumulated)) accumulated = t;
      else accumulated += t;
      // Live deltas run independent of span emission (text, not a span), so they flow even
      // when the harness self-instruments (emitSpans=false). `accumulated` is the cumulative
      // text, so the pure delta is its tail past what we already sent.
      if (sink) streamText(accumulated);
      return;
    }

    if (kind === "agent_thought_chunk") {
      const t = acpBlockText(update.content);
      if (!t) return;
      if (t.startsWith(reasoningAccumulated)) reasoningAccumulated = t;
      else reasoningAccumulated += t;
      if (sink) streamReasoning(reasoningAccumulated);
      return;
    }

    if (kind === "tool_call") {
      const id = update.toolCallId;
      if (!id) return;
      // A tool call ends any open text/reasoning block (keeps streamed block boundaries
      // clean across text -> tool -> text interleaving). No-op on the one-shot path.
      closeText();
      closeReasoning();
      const name = update.title || update.kind || "tool";
      let span: Span | undefined;
      if (emitSpans && turnCtx) {
        span = tracer.startSpan(`execute_tool ${name}`, undefined, turnCtx);
        span.setAttribute("openinference.span.kind", "TOOL");
        span.setAttribute("gen_ai.operation.name", "execute_tool");
        span.setAttribute("gen_ai.tool.name", String(name));
        span.setAttribute("gen_ai.tool.call.id", String(id));
        if (update.rawInput != null)
          setInputs(span, update.rawInput as Record<string, unknown>, capture);
      }
      toolSpans.set(id, { span, name: String(name) });
      record({ type: "tool_call", id: String(id), name: String(name), input: update.rawInput });
      // A tool_call can arrive already completed (status set up front).
      maybeCloseTool(id, update);
      return;
    }

    if (kind === "tool_call_update") {
      maybeCloseTool(update.toolCallId, update);
      return;
    }

    if (kind === "usage_update") {
      // ACP usage_update carries only `used` (context tokens) and `cost.amount`. The
      // per-call input/output split is NOT on the stream; it rides on the PromptResponse,
      // which the sandbox-agent engine reads. Keep total + cost here and leave the split to the caller.
      const cost = update.cost?.amount;
      const total = update.used;
      usage = {
        input: usage?.input ?? 0,
        output: usage?.output ?? 0,
        total: typeof total === "number" ? total : usage?.total ?? 0,
        cost: typeof cost === "number" ? cost : usage?.cost ?? 0,
      };
      record({ type: "usage", ...usage });
    }
  }

  /** Close a tool span when the update marks it completed or failed. */
  function maybeCloseTool(id: string | undefined, update: any): void {
    if (!id) return;
    const entry = toolSpans.get(id);
    if (!entry) return;
    const status = update?.status;
    if (status !== "completed" && status !== "failed") return;
    const out = acpToolContentText(update.content) || acpToolContentText(update.rawOutput);
    if (entry.span) {
      setOutput(entry.span, out, capture);
      if (status === "failed") entry.span.setStatus({ code: SpanStatusCode.ERROR });
      entry.span.end();
    }
    toolSpans.delete(id);
    record({ type: "tool_result", id, output: out, isError: status === "failed" });
  }

  function finish(): string {
    const text = stripStartupBanner(accumulated.trim());
    // The event log is independent of span emission, so build its tail either way.
    closeText();
    closeReasoning();
    if (sink) {
      // Streaming path: the block deltas were already flushed, so do NOT re-emit the
      // coalesced message (that would double it). If the harness produced no token deltas
      // at all but there is text, synthesize a minimal start/delta/end so the consumer
      // always sees one uniform block shape regardless of harness streaming support.
      if (text && !anyTextDelta) {
        const id = nextId("msg");
        record({ type: "message_start", id });
        record({ type: "message_delta", id, delta: text });
        record({ type: "message_end", id });
      }
    } else {
      // One-shot path: coalesced events only (no per-token granularity to recover).
      if (text) record({ type: "message", text });
      const reasoning = reasoningAccumulated.trim();
      if (reasoning) record({ type: "thought", text: reasoning });
    }
    record({ type: "done" });
    if (!emitSpans) return text;
    if (llmSpan) {
      emitMessages(
        llmSpan,
        "llm.output_messages",
        [{ role: "assistant", content: text }],
        capture,
      );
      stampUsage(llmSpan, usage);
      llmSpan.end();
      llmSpan = undefined;
    }
    for (const { span } of toolSpans.values()) span?.end();
    toolSpans.clear();
    if (turnSpan) {
      turnSpan.end();
      turnSpan = undefined;
    }
    if (agentSpan) {
      setOutput(agentSpan, text, capture);
      stampUsage(agentSpan, usage);
      agentSpan.end();
      agentSpan = undefined;
    }
    agentCtx = undefined;
    turnCtx = undefined;
    return text;
  }

  return {
    start,
    handleUpdate,
    emitEvent: record,
    finish,
    setUsage,
    flush: () => flushTrace(runTraceId),
    traceId: () => runTraceId,
    output: () => accumulated,
    events: () => events,
    usage: () => usage,
  };
}
