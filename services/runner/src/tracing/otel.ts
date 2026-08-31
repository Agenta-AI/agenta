/**
 * agenta-otel turns Pi lifecycle events into OpenTelemetry spans. Runner tracing may
 * export through HTTP; Pi injects a serialized-byte transport so the runner owns export.
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
 *   3. Per-run export destination. Runner tracing can supply an HTTP endpoint and
 *      authorization provider. Pi supplies only a serialized-byte transport, so no
 *      endpoint or export credential crosses into the Pi process.
 *
 * Span tree (per user prompt), unchanged from the POC:
 *   invoke_agent            (openinference.span.kind = AGENT)
 *     turn N                (CHAIN)
 *       chat <model>        (LLM)   — the provider request for that turn
 *       execute_tool <name> (TOOL)  — each tool the turn ran
 *
 * Runner HTTP fallback config (read lazily from the environment):
 *   AGENTA_API_INTERNAL_URL, AGENTA_API_URL  — fallback exporter endpoint
 *   AGENTA_CREDENTIALS                       — per-run caller credential (no static API key)
 *   OTEL_SERVICE_NAME            — resource service.name (default "pi-agent")
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  SpanStatusCode,
  type Context,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type {
  ReadableSpan,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import type { AgentEvent, AgentUsage, EmitEvent } from "../protocol.ts";
import type { Redactor } from "../redaction.ts";
import { logExportProblem } from "./export-diagnostics.ts";
import { createStreamTrace } from "./stream-trace.ts";

/** Machine-readable prefix on a sibling force-settle result (see TOOL_NOT_EXECUTED_PAUSED). The
 *  responder keys off this to keep the deferral out of the client-output store, and the web widget
 *  keys off it to render the sibling as deferred rather than failed. */
export const DEFERRED_NOT_EXECUTED_PREFIX = "DEFERRED_NOT_EXECUTED";

export const TOOL_NOT_EXECUTED_PAUSED = `${DEFERRED_NOT_EXECUTED_PREFIX}: paused for another approval; retry the same call if still required.`;

export const APPROVED_EXECUTION_RESULT_UNKNOWN =
  "APPROVED_EXECUTION_RESULT_UNKNOWN: the approved call started but its result was not observed before the pause ended the turn; do not assume it failed and do not retry a side-effecting call.";

/** Terminal result stamped on every open tool call when the USER stops (cancels) the turn. Unlike
 *  the pause sentinels this is a deliberate human halt, not a scheduling artifact: the call was cut
 *  off and may or may not have run, so the model must not silently retry it. Steer (stop + a new
 *  instruction) surfaces the user's guidance separately as the next turn's prompt. */
export const INTERRUPTED_BY_USER =
  "INTERRUPTED_BY_USER: the user stopped the turn before this call finished; it may not have completed. Do not retry it unless the user asks again.";

// ---------------------------------------------------------------------------
// Shared, process-wide tracing infrastructure
// ---------------------------------------------------------------------------

export type AuthorizationProvider = () => string | undefined;

/** One complete OTLP request body produced from a parent-first trace batch. */
export interface SerializedTraceBatch {
  body: Uint8Array;
  traceId: string;
  spanCount: number;
}

/** Bundle-safe destination for Pi-produced OTLP bytes, such as its atomic file publisher. */
export interface SerializedTraceBatchTransport {
  export(batch: SerializedTraceBatch): void | Promise<void>;
}

/** Where a trace's spans are shipped. The credential is read only when the batch is sent. */
interface HttpExportTarget {
  kind: "http";
  endpoint: string;
  authorization: AuthorizationProvider;
}

/** A non-network target used inside Pi to publish a standard serialized OTLP request. */
interface SerializedExportTarget {
  kind: "serialized";
  transport: SerializedTraceBatchTransport;
}

type ExportTarget = HttpExportTarget | SerializedExportTarget;

/** The target material resolved for one concrete export attempt. */
interface ResolvedExportTarget {
  endpoint: string;
  authorization?: string;
}

/** Monotonic id identifying one run's spans within a (possibly shared) trace. */
let nextRunId = 0;
function mintRunId(): string {
  return `run-${nextRunId++}`;
}

/** Context key carrying the owning run's id onto every span it starts (root and descendants). */
const RUN_ID_CONTEXT_KEY = createContextKey("agenta.otel.run_id");

function withRunId(ctx: Context, runId: string): Context {
  return ctx.setValue(RUN_ID_CONTEXT_KEY, runId);
}

function runIdOf(ctx: Context): string | undefined {
  return ctx.getValue(RUN_ID_CONTEXT_KEY) as string | undefined;
}

/**
 * traceId (hex) -> runId -> where that run's spans should be exported. A distributed trace can be
 * shared by concurrent runs (the caller's traceparent nests them all under the same trace id), and
 * two runs sharing a trace may legitimately export to DIFFERENT targets (different caller
 * endpoint/auth) — the target is a property of the RUN, not the trace. `registerRunTarget` adds a
 * run's target on start, `releaseRunTarget` removes it once that run's spans are flushed. Mirrors
 * `traceRedactors` below exactly, so the two per-trace accumulators never disagree about when a
 * trace's state is dead.
 */
const traceTargets = new Map<string, Map<string, ExportTarget>>();

function registerRunTarget(
  traceId: string,
  runId: string,
  target: ExportTarget,
): void {
  let byRun = traceTargets.get(traceId);
  if (!byRun) {
    byRun = new Map();
    traceTargets.set(traceId, byRun);
  }
  byRun.set(runId, target);
}

/** Drop one run's target from the trace's accumulator; the trace entry itself is only removed
 * once no run remains registered (a later batch from another run may still export). */
function releaseRunTarget(traceId: string, runId: string): void {
  const byRun = traceTargets.get(traceId);
  if (!byRun) return;
  byRun.delete(runId);
  if (byRun.size === 0) traceTargets.delete(traceId);
}

/** spanId (hex) -> the runId that started it, so a flushed batch can be split per run and each
 * sub-batch shipped to the target of the run that actually produced it. Entries are removed as
 * spans are consumed by flush() so this never grows unbounded. */
const spanRunIds = new Map<string, string>();

/**
 * traceId (hex) -> the deny-set of every RUN currently registered on that trace. A distributed
 * trace can be shared by concurrent runs (the caller's traceparent nests them all under the same
 * trace id), so this is an accumulator, not a single slot: `registerRunRedactor` adds a run's
 * redactor on start, `releaseRunRedactor` removes it once that run's spans are flushed. A flush
 * applies every redactor still registered for the trace, and the trace entry is only dropped once
 * the registered set is empty — never on the first flush.
 */
const traceRedactors = new Map<string, Set<Redactor>>();

function registerRunRedactor(traceId: string, redactor: Redactor): void {
  let set = traceRedactors.get(traceId);
  if (!set) {
    set = new Set();
    traceRedactors.set(traceId, set);
  }
  set.add(redactor);
}

/** Drop one run's redactor from the trace's accumulator; the trace entry itself is only
 * removed once no run remains registered (a later batch from another run may still export). */
function releaseRunRedactor(traceId: string, redactor: Redactor): void {
  const set = traceRedactors.get(traceId);
  if (!set) return;
  set.delete(redactor);
  if (set.size === 0) traceRedactors.delete(traceId);
}

/** Redact every string-valued span attribute, event attribute, and the status message in place
 * (known-value pass; sink-level, right before export — same rationale as the persist.ts sink).
 * Applies EVERY redactor registered for the trace, so overlapping runs' secrets are all caught.
 * Fail-safe: redactString/redactJson never throw. */
function redactSpan(span: ReadableSpan, redactors: Iterable<Redactor>): void {
  for (const redactor of redactors) {
    redactAttributes(span.attributes as Record<string, unknown>, redactor);
    for (const event of span.events) {
      if (event.attributes) {
        redactAttributes(event.attributes as Record<string, unknown>, redactor);
      }
    }
    const status = span.status as { message?: string };
    if (typeof status.message === "string") {
      status.message =
        redactor.redactString(status.message, "spans") ?? status.message;
    }
  }
}

function redactAttributes(
  attrs: Record<string, unknown>,
  redactor: Redactor,
): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string") {
      attrs[key] = redactor.redactString(value, "spans");
    } else if (
      Array.isArray(value) &&
      value.every((v) => typeof v === "string")
    ) {
      attrs[key] = value.map((v) => redactor.redactString(v, "spans"));
    }
  }
}

interface ExporterCacheEntry {
  authorization?: string;
  exporter: OTLPTraceExporter;
  activeExports: number;
  retired: boolean;
  shutdown?: Promise<void>;
}

/** Cache the current exporter per endpoint and retire it safely when the credential rotates. */
const exporterCache = new Map<string, ExporterCacheEntry>();
/** Only retired exporters with an active request remain here, so rotation cannot grow it unbounded. */
const retiringExporters = new Set<ExporterCacheEntry>();

function shutdownExporter(entry: ExporterCacheEntry): Promise<void> {
  entry.shutdown ??= entry.exporter.shutdown();
  return entry.shutdown;
}

function retireExporter(entry: ExporterCacheEntry): void {
  entry.retired = true;
  if (entry.activeExports === 0) {
    void shutdownExporter(entry).catch(() => {});
    return;
  }
  retiringExporters.add(entry);
}

function completeExport(entry: ExporterCacheEntry): void {
  entry.activeExports -= 1;
  if (!entry.retired || entry.activeExports !== 0) return;
  retiringExporters.delete(entry);
  void shutdownExporter(entry).catch(() => {});
}

function getExporter(target: ResolvedExportTarget): ExporterCacheEntry {
  const cached = exporterCache.get(target.endpoint);
  if (cached && cached.authorization === target.authorization) return cached;

  const entry: ExporterCacheEntry = {
    authorization: target.authorization,
    exporter: new OTLPTraceExporter({
      url: target.endpoint,
      headers: target.authorization
        ? { Authorization: target.authorization }
        : {},
      timeoutMillis: 10_000,
    }),
    activeExports: 0,
    retired: false,
  };
  if (cached) retireExporter(cached);
  exporterCache.set(target.endpoint, entry);
  return entry;
}

const CLOUD_API_BASE = "https://cloud.agenta.ai/api";

/** Fallback target from env, used when a trace was started without an explicit one. */
function defaultTarget(): HttpExportTarget {
  // Internal direct hop first, then the public `.../api` base, then cloud.
  const base =
    (
      process.env.AGENTA_API_INTERNAL_URL ?? process.env.AGENTA_API_URL
    )?.replace(/\/+$/, "") || CLOUD_API_BASE;
  // The per-run caller credential rides the request (each explicit trace target carries its own
  // authorization; Pi's runner-owned exporter receives it only at send time). The runner holds no static
  // platform key: it must not carry an `AGENTA_API_KEY` a local harness could read from /proc and
  // reuse (interface.md section 2). The scheme-tagged ephemeral `AGENTA_CREDENTIALS` (a
  // `Secret ...` from `/check`, used verbatim) is the only fallback; absent it, `flush` skips
  // the export rather than sending Agenta an unauthenticated one (see `isAgentaIngest`).
  return {
    kind: "http",
    endpoint: `${base}/otlp/v1/traces`,
    authorization: () => process.env.AGENTA_CREDENTIALS || undefined,
  };
}

/** Add the runner's live platform credential as the fallback for a blank request credential. */
export function platformAuthorizationProvider(
  configured?: string | AuthorizationProvider,
): AuthorizationProvider {
  const configuredProvider =
    typeof configured === "function" ? configured : () => configured;
  const fallbackAuthorization = defaultTarget().authorization;
  return () => {
    const resolved = configuredProvider();
    return resolved?.trim() ? resolved : fallbackAuthorization();
  };
}

/** Resolve the trace endpoint exactly as the runner's ordinary span exporter does. */
export function resolveOtlpTraceEndpoint(endpoint?: string): string {
  return endpoint?.trim() || defaultTarget().endpoint;
}

/**
 * Does this endpoint speak Agenta's own ingest, which always requires a credential? Only there
 * is a credential-less export pointless — a caller may instead aim a run at a third-party
 * collector (a local OTel collector, Jaeger, a host behind network auth), and those accept
 * unauthenticated spans, so those must still be sent.
 *
 * Both configured bases count, not only the one `defaultTarget` picked: a run can be handed the
 * public URL while the runner's own hop is internal. The full normalized ingest URL must match,
 * because a third-party collector may share the Agenta host behind a different proxy path.
 */
export function isAgentaIngest(endpoint: string): boolean {
  const normalize = (value: string): string | undefined => {
    try {
      const url = new URL(value);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${path}`;
    } catch {
      return undefined;
    }
  };

  const normalizedEndpoint = normalize(endpoint);
  if (!normalizedEndpoint) return false;
  return configuredIngestBases().some(
    (base) =>
      normalize(`${base.replace(/\/+$/, "")}/otlp/v1/traces`) ===
      normalizedEndpoint,
  );
}

/** Hosts the platform rewrites to `host.docker.internal` before it dispatches a run. */
const BRIDGE_REWRITTEN_HOSTS = new Set(["localhost", "0.0.0.0"]);

/**
 * The same base the platform would hand a dispatched run, or undefined when it rewrites nothing.
 *
 * A self-hoster's natural `AGENTA_API_URL` is a localhost URL, but a sandboxed run cannot reach
 * the host that way from inside its own container, so the trace endpoint is rewritten to
 * `host.docker.internal` on the way out. The runner reads only the raw env value, so the
 * configured base and the endpoint it is handed can never string-match, and every run of such a
 * deployment loses its platform credential.
 *
 * The authority for that rewrite is `parse_url` in `sdks/python/agenta/sdk/utils/helpers.py`, NOT
 * the api's same-named twin in `api/oss/src/utils/helpers.py`. The endpoint on the wire is
 * `ag.tracing.otlp_url`, which the agent service derives through the SDK's copy; the api's copy
 * shapes the service URL a run is POSTed to. The two differ, and the differences are what the
 * limits below are about.
 *
 * The mirror is deliberately exact: same scheme, port, and path, and only the two hosts the
 * rewrite touches. Three things it deliberately does NOT do:
 *
 *   - `127.0.0.1` earns no alias. Neither copy of `parse_url` rewrites it, so that deployment
 *     already matches its own raw base and the bridge form is a pair the platform cannot produce.
 *   - A scheme-less base earns no alias, because it cannot help. The SDK's `parse_url` does no
 *     scheme defaulting (unlike the api's), so a scheme-less `AGENTA_API_URL` yields an equally
 *     scheme-less ENDPOINT, which `new URL` reads as an opaque `localhost:`-scheme path. Both
 *     sides are then unparseable and no aliasing here can make them agree. Such a deployment is
 *     broken further upstream — the OTLP exporter target itself is malformed — and the fix is
 *     scheme defaulting in the SDK's `parse_url`, not a wider allowlist.
 *   - The alias is not gated on the docker network mode, even though the rewrite is: the SDK's
 *     `parse_url` rewrites only when `DOCKER_NETWORK_MODE` is exactly `bridge`, so in `host` mode
 *     (and when the var is unset) the platform dispatches the unrewritten localhost endpoint,
 *     which the raw base already matches, and this alias is merely unused. Gating it is not
 *     possible and would not be safe: the runner's environment carries no `DOCKER_NETWORK_MODE`
 *     (it takes no `env_file` by design, and the var is absent from its `environment:` block in
 *     every compose file), so the runner cannot tell "unset" from "bridge, but invisible to me" —
 *     and those two need OPPOSITE answers. A mode-gated alias would read "unset" and emit
 *     nothing on exactly the bridge deployments this exists to fix.
 *
 * What that last point leaves is a residual width: in host mode the allowlist also admits
 * `host.docker.internal` on the configured port, an endpoint the platform will not dispatch
 * there. It is not an attack surface. The endpoint is always platform-dispatched — the runner
 * reads it from the run request the agent service builds — and reaching the runner directly needs
 * `AGENTA_RUNNER_TOKEN` inside the compose network, where a forged request carries its own
 * credential anyway. The only real exposure is a third-party collector on the docker host at the
 * exact port of the configured Agenta api, which in practice is that api.
 */
function bridgeRewrittenBase(base: string): string | undefined {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  if (!BRIDGE_REWRITTEN_HOSTS.has(url.hostname)) return undefined;
  url.hostname = "host.docker.internal";
  return url.toString().replace(/\/+$/, "");
}

/** The api bases `isAgentaIngest` accepts, in precedence order. Exported so a rejection can name
 * what it compared against — the failure is always a configuration gap, never a code path. */
export function configuredIngestBases(): string[] {
  const configured = [
    process.env.AGENTA_API_INTERNAL_URL,
    process.env.AGENTA_API_URL,
    CLOUD_API_BASE,
  ].filter((base): base is string => Boolean(base));

  return configured.flatMap((base) => {
    const bridged = bridgeRewrittenBase(base);
    return bridged ? [base, bridged] : [base];
  });
}

/**
 * Has the operator told this runner its platform's PUBLIC api base?
 *
 * Only `AGENTA_API_URL` counts. `AGENTA_API_INTERNAL_URL` is the in-network hop and never appears
 * in a dispatched run's trace endpoint, so it cannot settle whether a public-looking endpoint is
 * this platform or someone else's collector. Cloud is self-describing: a runner reaching the cloud
 * api needs no operator input, so the built-in cloud base counts as configured.
 */
export function publicApiBaseConfigured(): boolean {
  return Boolean(
    process.env.AGENTA_API_URL?.trim() ||
    process.env.AGENTA_API_INTERNAL_URL?.trim()?.startsWith(CLOUD_API_BASE),
  );
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

  // Tag every span with the run id ambient in its start context (see `withRunId`), so a later
  // flush can tell which run produced it — concurrent runs sharing a trace id may have DIFFERENT
  // export targets, and a batch must go to the target of the run that produced it, not to
  // whichever run happens to still be registered on the trace.
  onStart(span: Span, parentContext: Context): void {
    const runId = runIdOf(parentContext);
    if (runId) spanRunIds.set(span.spanContext().spanId, runId);
  }

  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;
    const spans = this.buffers.get(traceId) ?? [];
    spans.push(span);
    this.buffers.set(traceId, spans);
    // No parent in this process => this is the local root and the trace is done.
    if (!span.parentSpanContext?.spanId) {
      this.flush(traceId);
    }
  }

  /** Export and drop one trace's buffered spans, split into one sub-batch PER RUN and shipped to
   * that run's own target (two runs sharing a trace id may have different endpoint/auth). Resolves
   * once every sub-batch's export returns. Does NOT clear the trace's registered redactors or
   * per-run targets for runs other than the ones this batch just exported — those live until each
   * registered run releases (see `releaseRunRedactor`/`releaseRunTarget`), since a later batch on
   * the same trace id can still be emitted by another still-running run sharing the trace. */
  flush(traceId: string): Promise<void> {
    const spans = this.buffers.get(traceId);
    if (!spans || spans.length === 0) return Promise.resolve();
    this.buffers.delete(traceId);

    // Redact at the sink: the last point before the spans leave the process. Apply every
    // redactor currently registered for this trace (concurrent runs sharing a trace id).
    const redactors = traceRedactors.get(traceId);
    if (redactors && redactors.size > 0)
      for (const span of spans) redactSpan(span, redactors);

    const byRun = traceTargets.get(traceId);
    const groups = new Map<string | undefined, ReadableSpan[]>();
    for (const span of spans) {
      const spanId = span.spanContext().spanId;
      const runId = spanRunIds.get(spanId);
      spanRunIds.delete(spanId);
      const group = groups.get(runId) ?? [];
      group.push(span);
      groups.set(runId, group);
    }

    return Promise.all(
      [...groups.entries()].map(([runId, group]) => {
        // Fall back to the env default only for a span whose OWN run's target is unknown
        // (untagged span, or the run already released) — never to another run's target, or a
        // batch could still land on an unintended endpoint/auth.
        const target =
          (runId ? byRun?.get(runId) : undefined) ?? defaultTarget();
        if (target.kind === "serialized") {
          try {
            const body = serializeTraceBatch(group);
            if (!body)
              throw new Error("OTLP trace serialization returned no body");
            return Promise.resolve(
              target.transport.export({
                body,
                traceId,
                spanCount: group.length,
              }),
            ).catch((error) => {
              logSerializedTransportProblem(
                traceId,
                group.length,
                error,
                redactors,
              );
            });
          } catch (error) {
            logSerializedTransportProblem(
              traceId,
              group.length,
              error,
              redactors,
            );
            return Promise.resolve();
          }
        }
        const ordered = orderParentFirst(group);
        let resolvedTarget: ResolvedExportTarget;
        try {
          resolvedTarget = {
            endpoint: target.endpoint,
            authorization: target.authorization(),
          };
        } catch (error) {
          logExportProblem({
            traceId,
            endpoint: target.endpoint,
            authorization: undefined,
            spans: group.length,
            redactors,
            outcome: "threw",
            error,
          });
          return Promise.resolve();
        }
        const problem = {
          traceId,
          endpoint: resolvedTarget.endpoint,
          authorization: resolvedTarget.authorization,
          spans: group.length,
          redactors,
        };
        if (
          !resolvedTarget.authorization?.trim() &&
          isAgentaIngest(resolvedTarget.endpoint)
        ) {
          // Agenta's ingest rejects an unauthenticated export, so sending one buys nothing and
          // reports as a 401 that reads like a BAD credential. Say the credential is missing
          // instead, and drop the batch here.
          logExportProblem({ ...problem, outcome: "skipped" });
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          let entry: ExporterCacheEntry | undefined;
          let exportSettled = false;
          const settleExport = (): void => {
            if (!exportSettled && entry) {
              exportSettled = true;
              completeExport(entry);
            }
            resolve();
          };
          try {
            entry = getExporter(resolvedTarget);
            entry.activeExports += 1;
            entry.exporter.export(ordered, (result) => {
              try {
                if (result.code === ExportResultCode.FAILED)
                  logExportProblem({
                    ...problem,
                    outcome: "failed",
                    error: result.error,
                  });
              } finally {
                settleExport();
              }
            });
          } catch (err) {
            // A synchronous export throw (e.g. misconfigured exporter) must stay best-effort:
            // flush() is awaited without a catch, so a reject here would break the run.
            settleExport();
            logExportProblem({ ...problem, outcome: "threw", error: err });
          }
        });
      }),
    ).then(() => undefined);
  }

  forceFlush(): Promise<void> {
    return Promise.all(
      [...this.buffers.keys()].map((traceId) => this.flush(traceId)),
    ).then(() => undefined);
  }

  shutdown(): Promise<void> {
    return this.forceFlush().then(async () => {
      await Promise.all(
        [...exporterCache.values(), ...retiringExporters].map((entry) =>
          shutdownExporter(entry),
        ),
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
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "pi-agent",
    }),
    spanProcessors: [processor],
  });
  provider.register();
}

/**
 * Flush one trace's spans to Agenta. Call after a run whose root has a remote parent. `redactor`
 * and `runId` are released from the trace's accumulators AFTER the export resolves — this run is
 * done contributing spans, but other runs still registered on the same trace id (a shared
 * distributed trace) keep their redactor/target live for later batches.
 */
export async function flushTrace(
  traceId?: string,
  redactor?: Redactor,
  runId?: string,
): Promise<void> {
  if (!processor || !traceId) return;
  try {
    await processor.flush(traceId);
  } finally {
    if (redactor) releaseRunRedactor(traceId, redactor);
    if (runId) releaseRunTarget(traceId, runId);
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
    const parentId = s.parentSpanContext?.spanId;
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
    for (const child of childrenOf.get(s.spanContext().spanId) ?? [])
      visit(child);
  };
  roots.forEach(visit);
  // Any spans not reached (defensive) get appended so nothing is dropped.
  if (ordered.length !== spans.length) {
    const seen = new Set(ordered);
    for (const s of spans) if (!seen.has(s)) ordered.push(s);
  }
  return ordered;
}

/** Serialize one complete trace batch in the exact parent-first order Agenta ingest expects. */
export function serializeTraceBatch(
  spans: ReadableSpan[],
): Uint8Array | undefined {
  return ProtobufTraceSerializer.serializeRequest(orderParentFirst(spans));
}

function logSerializedTransportProblem(
  traceId: string,
  spanCount: number,
  error: unknown,
  redactors?: Iterable<Redactor>,
): void {
  let message = error instanceof Error ? error.message : String(error);
  for (const redactor of redactors ?? [])
    message = redactor.redactString(message, "stderr") ?? message;
  console.error(
    "otel: serialized trace transport threw",
    JSON.stringify({ traceId, spans: spanCount, error: message.slice(0, 200) }),
  );
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
    traceFlags:
      (parseInt(flags, 16) & 1) === 1 ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
  return trace.setSpanContext(ROOT_CONTEXT, spanContext);
}

// ---------------------------------------------------------------------------
// Per-run config + content helpers
// ---------------------------------------------------------------------------

/** One run's tracing config. Mutated by the runner after the session is created. */
export interface RunConfig {
  /** False when this warm Pi turn did not receive a valid runner control file. */
  enabled?: boolean;
  /** OTLP traces endpoint for this run's trace (falls back to env). */
  endpoint?: string;
  /** Authorization header value for the OTLP export (falls back to env ApiKey). */
  authorization?: string;
  /** Optional bundle-safe Pi transport that receives raw OTLP bytes instead of sending HTTP. */
  serializedBatchTransport?: SerializedTraceBatchTransport;
  /** W3C traceparent from the caller; nests invoke_agent under that span. */
  traceparent?: string;
  /** W3C baggage from the caller (carried for future use). */
  baggage?: string;
  /** Durable turn id stamped as runner metadata when supplied. */
  turnId?: string;
  /** Drop prompt/completion/tool I/O from spans when false. */
  captureContent: boolean;
  /** Pi session id, set after createAgentSession so spans carry session.id. */
  sessionId?: string;
  /** Resolved provider, set after the model is picked. */
  provider?: string;
  /** Resolved model id, set after the model is picked. */
  requestModel?: string;
  /**
   * Skill names materialized for this run (author + forced `_agenta.*`), stamped on the agent
   * span so a trace shows which skills loaded (F-029). Set on the local-Pi path, where Pi's own
   * extension owns the agent span (the runner's sandbox-agent otel is span-less there).
   */
  skills?: string[];
  /** Per-run known-value redactor; scrubs the run's live secrets from exported spans. */
  redactor?: Redactor;
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
/** Returns the error message when the assistant turn failed (stopReason/errorMessage), else
 * undefined — so the caller can emit a matching `error` event, not just stamp the span. */
function applyAssistant(
  span: Span,
  msg: any,
  capture: boolean,
): string | undefined {
  if (msg.provider) span.setAttribute("gen_ai.system", msg.provider);
  if (msg.model) span.setAttribute("gen_ai.request.model", msg.model);
  if (msg.responseModel || msg.model)
    span.setAttribute("gen_ai.response.model", msg.responseModel ?? msg.model);
  if (msg.responseId) span.setAttribute("gen_ai.response.id", msg.responseId);
  if (msg.stopReason)
    span.setAttribute("gen_ai.response.finish_reasons", [
      String(msg.stopReason),
    ]);

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
    // Dotted form: matches logfire_adapter.py's ingest keys (underscore form was never read).
    // Nullish check, not truthy, so a real 0 is emitted like the other token fields.
    if (u.cacheRead != null)
      span.setAttribute("gen_ai.usage.cache_read.input_tokens", u.cacheRead);
    if (u.cacheWrite != null)
      span.setAttribute(
        "gen_ai.usage.cache_creation.input_tokens",
        u.cacheWrite,
      );
    if (u.cost?.total != null)
      span.setAttribute("gen_ai.usage.cost", u.cost.total);
  }

  emitMessages(span, "llm.output_messages", [msg], capture);
  if (msg.stopReason === "error" || msg.errorMessage) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: msg.errorMessage });
    return String(msg.errorMessage || "agent run failed");
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Extension factory (one per run; state is closure-scoped)
// ---------------------------------------------------------------------------

export interface AgentaOtel {
  /** Register with DefaultResourceLoader.extensionFactories. */
  register: (pi: ExtensionAPI) => void;
  /** Mutable config; set sessionId/provider/requestModel after the session exists. */
  config: RunConfig;
  /** Replace all per-turn Pi state and reset usage before a warm prompt begins. */
  beginTurn: (next: Partial<RunConfig>) => void;
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
    enabled: init.enabled,
    endpoint: init.endpoint,
    authorization: init.authorization,
    serializedBatchTransport: init.serializedBatchTransport,
    traceparent: init.traceparent,
    baggage: init.baggage,
    captureContent: init.captureContent !== false,
    sessionId: init.sessionId,
    turnId: init.turnId,
    provider: init.provider,
    requestModel: init.requestModel,
    skills: init.skills,
    redactor: init.redactor,
  };

  const tracer = trace.getTracer("agenta-pi-otel", "0.1.0");
  const runId = mintRunId();

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

  function beginTurn(next: Partial<RunConfig>): void {
    config.enabled = next.enabled;
    config.endpoint = next.endpoint;
    config.authorization = next.authorization;
    config.serializedBatchTransport = next.serializedBatchTransport;
    config.traceparent = next.traceparent;
    config.baggage = next.baggage;
    config.captureContent = next.captureContent !== false;
    config.sessionId = next.sessionId;
    config.turnId = next.turnId;
    config.provider = next.provider;
    config.requestModel = next.requestModel;
    config.skills = next.skills;
    config.redactor = next.redactor;
    config.traceId = undefined;
    runUsage.input = 0;
    runUsage.output = 0;
    runUsage.total = 0;
    runUsage.cost = 0;
  }

  const register = (pi: ExtensionAPI): void => {
    pi.on("before_agent_start", async (event: any) => {
      pendingPrompt = event?.prompt;
    });

    pi.on("agent_start", async () => {
      if (config.enabled === false) return;
      // Nest under the caller's workflow span when a traceparent was supplied,
      // so the whole run joins the /invoke trace; otherwise start a fresh root.
      // Tag the run id onto the start context BEFORE creating the root span, so onStart
      // attributes invoke_agent itself (and every descendant) to this run.
      const parent = withRunId(
        parentContext(config.traceparent) ?? context.active(),
        runId,
      );
      agentSpan = tracer.startSpan("invoke_agent", undefined, parent);
      agentSpan.setAttribute("openinference.span.kind", "AGENT");
      agentSpan.setAttribute("gen_ai.operation.name", "invoke_agent");
      agentSpan.setAttribute("gen_ai.agent.name", "pi");
      // F-029/F-036: record which skills loaded on Pi's own agent span under the recognized
      // `ag.meta.*` namespace, so a local-Pi trace shows the surfaced skills (not just the author
      // config echoed elsewhere) AND Agenta's OTel ingest keeps them in a first-class `ag.*` bucket
      // rather than relocating an unrecognized `ag.agent.*` key to `ag.unsupported.*`. The set is
      // passed from the runner through the per-turn trace control.
      if (config.skills && config.skills.length > 0) {
        agentSpan.setAttribute("ag.meta.skills.loaded", config.skills);
        agentSpan.setAttribute("ag.meta.skills.count", config.skills.length);
      }
      if (config.sessionId) {
        agentSpan.setAttribute("session.id", config.sessionId);
        agentSpan.setAttribute("gen_ai.conversation.id", config.sessionId);
      }
      if (config.turnId)
        agentSpan.setAttribute("ag.meta.turn.id", config.turnId);
      setInputs(
        agentSpan,
        { prompt: pendingPrompt ?? "" },
        config.captureContent,
      );

      const traceId = agentSpan.spanContext().traceId;
      config.traceId = traceId;
      registerRunTarget(
        traceId,
        runId,
        config.serializedBatchTransport
          ? {
              kind: "serialized",
              transport: config.serializedBatchTransport,
            }
          : {
              kind: "http",
              endpoint: config.endpoint ?? defaultTarget().endpoint,
              authorization: () =>
                config.authorization ?? defaultTarget().authorization(),
            },
      );
      if (config.redactor) registerRunRedactor(traceId, config.redactor);
      agentCtx = trace.setSpan(parent, agentSpan);
    });

    // The messages handed to the next LLM call — the chat span's input.
    pi.on("context", async (event: any) => {
      if (Array.isArray(event?.messages)) lastContextMessages = event.messages;
    });

    pi.on("turn_start", async (event: any) => {
      if (config.enabled === false) return;
      const parent = agentCtx ?? context.active();
      const name =
        event?.turnIndex != null ? `turn ${event.turnIndex}` : "turn";
      const span = tracer.startSpan(name, undefined, parent);
      span.setAttribute("openinference.span.kind", "CHAIN");
      if (event?.turnIndex != null)
        span.setAttribute("pi.turn.index", event.turnIndex);
      currentTurn = {
        span,
        ctx: trace.setSpan(parent, span),
        index: event?.turnIndex,
      };
    });

    pi.on("before_provider_request", async (_event: any, ctx: any) => {
      if (config.enabled === false) return;
      const parent = currentTurn?.ctx ?? agentCtx ?? context.active();
      const modelId = config.requestModel ?? ctx?.model?.id;
      const providerName = config.provider ?? ctx?.model?.provider;
      llmSpan = tracer.startSpan(
        modelId ? `chat ${modelId}` : "chat",
        undefined,
        parent,
      );
      llmSpan.setAttribute("openinference.span.kind", "LLM");
      llmSpan.setAttribute("gen_ai.operation.name", "chat");
      if (providerName) llmSpan.setAttribute("gen_ai.system", providerName);
      if (modelId) llmSpan.setAttribute("gen_ai.request.model", modelId);
      if (lastContextMessages)
        emitMessages(
          llmSpan,
          "llm.input_messages",
          lastContextMessages,
          config.captureContent,
        );
    });

    pi.on("message_end", async (event: any) => {
      const msg = event?.message;
      if (!msg || msg.role !== "assistant") return;
      accumulateUsage(msg);
      if (!llmSpan) return;
      applyAssistant(llmSpan, msg, config.captureContent);
      llmSpan.end();
      llmSpan = undefined;
    });

    pi.on("tool_execution_start", async (event: any) => {
      if (config.enabled === false) return;
      const parent = currentTurn?.ctx ?? agentCtx ?? context.active();
      const name = event?.toolName
        ? `execute_tool ${event.toolName}`
        : "execute_tool";
      const span = tracer.startSpan(name, undefined, parent);
      span.setAttribute("openinference.span.kind", "TOOL");
      span.setAttribute("gen_ai.operation.name", "execute_tool");
      if (event?.toolName)
        span.setAttribute("gen_ai.tool.name", event.toolName);
      if (event?.toolCallId)
        span.setAttribute("gen_ai.tool.call.id", event.toolCallId);
      setInputs(
        span,
        (event?.args as Record<string, unknown>) ?? {},
        config.captureContent,
      );
      if (event?.toolCallId) toolSpans.set(event.toolCallId, span);
    });

    pi.on("tool_execution_end", async (event: any) => {
      const span = event?.toolCallId
        ? toolSpans.get(event.toolCallId)
        : undefined;
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
      // Cancellation may skip message_end, tool_execution_end, and turn_end. Close every child
      // before the agent root so the one native batch contains all partial work Pi still holds.
      if (llmSpan) {
        llmSpan.end();
        llmSpan = undefined;
      }
      for (const span of toolSpans.values()) span.end();
      toolSpans.clear();
      if (currentTurn) {
        currentTurn.span.end();
        currentTurn = undefined;
      }
      setOutput(
        agentSpan,
        lastAssistantText(event?.messages),
        config.captureContent,
      );
      // Stamp the run total on the agent span so it shows the agent's tokens/cost even
      // though Agenta cannot roll the per-turn LLM spans up across batches.
      if (runUsage.total > 0) {
        agentSpan.setAttribute("gen_ai.usage.input_tokens", runUsage.input);
        agentSpan.setAttribute("gen_ai.usage.output_tokens", runUsage.output);
        agentSpan.setAttribute("gen_ai.usage.prompt_tokens", runUsage.input);
        agentSpan.setAttribute(
          "gen_ai.usage.completion_tokens",
          runUsage.output,
        );
        agentSpan.setAttribute("gen_ai.usage.total_tokens", runUsage.total);
        if (runUsage.cost > 0)
          agentSpan.setAttribute("gen_ai.usage.cost", runUsage.cost);
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
    beginTurn,
    flush: () => flushTrace(config.traceId, config.redactor, runId),
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
  if (block.type === "text" && typeof block.text === "string")
    return block.text;
  return "";
}

/** Serialized form of real tool args, for change detection; undefined when absent/`{}`. */
function toolInputJson(input: unknown): string | undefined {
  if (!hasToolArgs(input)) return undefined;
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

/**
 * Whether a tool's `rawInput` holds real, inspectable args. A harness can announce a call with
 * an absent or empty `{}` input and fill the args in on a later `tool_call_update` (Pi does);
 * both placeholders count as "no args yet" so we know to refresh the tool_call once the real
 * args land. Purely shape-based — no harness-specific logic.
 */
function hasToolArgs(input: unknown): boolean {
  if (input == null) return false;
  if (
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input as Record<string, unknown>).length === 0
  )
    return false;
  return true;
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

/** JSON of a value, treating "no information" serializations as absent. */
function jsonText(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (!text || text === "{}" || text === "[]" || text === "null") return "";
    return text;
  } catch {
    return "";
  }
}

/**
 * Text of an OBJECT `rawOutput`. codex-acp never sends a `content` array on the update that
 * completes a tool call — it sends a plain object whose shape depends on the tool: shell/exec
 * `{formatted_output, exit_code}`, an MCP call `{result, error}` (result being an MCP
 * CallToolResult carrying `content[]`), the unified exec path `{output}`. `acpToolContentText`
 * reads none of those and returns "", which is why every codex tool result — successes and
 * failures alike — stored and streamed empty.
 *
 * Candidates are tried in that order and an empty one falls through to the next, so a failed MCP
 * call (`{result: null, error: "..."}`) carries its real error message; an object with no known
 * key serializes whole, so a completed call is never silently empty.
 */
function acpRawOutputText(raw: any): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  for (const key of ["formatted_output", "result", "output", "error"]) {
    const value = raw[key];
    if (typeof value === "string") {
      if (value) return value;
      continue;
    }
    if (value && typeof value === "object") {
      const text =
        acpToolContentText(value.content) || acpToolContentText(value);
      if (text) return text;
      const json = jsonText(value);
      if (json) return json;
    }
  }
  return jsonText(raw);
}

/**
 * Is this line part of the pi-acp startup banner that some setups emit as the first agent
 * message chunk, ahead of the real answer? pi-acp's `buildStartupInfo` produces, in order:
 *
 *   pi v0.79.4
 *   ---
 *   (blank)
 *   ## Context
 *   - /tmp/agenta-sandbox-agent-XXXX/AGENTS.md
 *   (blank)
 *   ## Skills            (when skills are installed)
 *   - /path/to/skill.md
 *   (blank)
 *   New version available: v0.80.2 (installed v0.79.4). Run: `npm i -g @earendil-works/pi-coding-agent`
 *
 * The markdown markers (`## `, `- `) are stripped when the playground renders the text, so the
 * user sees a bare `Context` heading and an unprefixed absolute `.../AGENTS.md` path — but the
 * raw chunk still carries the markdown, so we match BOTH the raw and the rendered shapes. The
 * "New version available" notice is emitted even when `quietStartup` suppresses the rest, so it
 * must be matched on its own. We only ever strip a LEADING run of these lines, so a genuine
 * answer that happens to contain such words later is never touched.
 */
export function isBannerLine(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    t === "---" ||
    /^pi v\d+\.\d+\.\d+\b/.test(t) ||
    // section heading, raw ("## Context") or rendered ("Context"); same for "Skills"
    /^(?:#{1,6}\s*)?(?:Context|Skills|Extensions)\s*$/.test(t) ||
    // an AGENTS.md / *.md path item, list-prefixed ("- /…/AGENTS.md") or bare ("/…/AGENTS.md")
    /^(?:-\s+)?\/\S*\.(?:md|js)\s*$/.test(t) ||
    // upgrade notice: "New version available: vX (installed vY). Run: `npm i -g …`"
    /^New version available:/.test(t) ||
    /^Run:\s*`?npm\s+i\b/.test(t)
  );
}

/**
 * Strip a leading run of pi-acp startup-banner lines from `text`. Returns the text past the
 * banner (trimmed) when at least one non-blank banner line was seen, otherwise the original.
 */
export function stripStartupBanner(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  let sawBanner = false;
  while (i < lines.length && isBannerLine(lines[i])) {
    if (lines[i].trim() !== "") sawBanner = true;
    i++;
  }
  return sawBanner ? lines.slice(i).join("\n").trim() : text;
}

/**
 * Streaming-safe variant. Given the cumulative assistant text so far, return the portion that
 * is safe to surface as a delta now, plus whether the leading banner region is fully resolved.
 *
 * The banner always arrives at the START of the stream and may straddle chunk boundaries, so we
 * must not classify the LAST line until we know it is complete (a trailing newline, or a later
 * chunk, settles it). While the text seen so far is entirely banner-or-blank we return
 * `{ body: "", settled: false }` and the caller holds emission; once a non-banner line appears
 * we return everything from it onward and never re-buffer again. `start` is the byte offset of
 * the body within `text` (after leading whitespace), so the caller can slice later chunks from
 * the same offset — the banner is a stable leading prefix of the cumulative stream.
 */
export function splitLeadingBanner(text: string): {
  body: string;
  settled: boolean;
  start: number;
} {
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  // The final element is a partial line unless the text ended on a newline.
  const lastIsPartial = !endsWithNewline;
  let i = 0;
  let offset = 0; // byte offset of line i within `text`
  let sawBanner = false;
  while (i < lines.length) {
    const isLast = i === lines.length - 1;
    if (isLast && lastIsPartial && sawBanner) {
      // We are at the banner boundary with a still-arriving partial line. It could complete into
      // either another banner line or the first line of the real answer — only a later chunk (or
      // a newline) settles it, so hold. (When no banner has been seen, there is nothing to
      // suppress: settle on the partial line and stream it without latency.)
      return { body: "", settled: false, start: -1 };
    }
    if (!isBannerLine(lines[i])) break;
    sawBanner = true;
    offset += lines[i].length + 1; // +1 for the consumed "\n"
    i++;
  }
  if (i >= lines.length) {
    // Consumed every (complete) line as banner — nothing real has started yet.
    return { body: "", settled: false, start: -1 };
  }
  const rest = text.slice(offset);
  // Drop the blank line(s) that separate the banner from the answer, but never trim a
  // banner-free stream — a genuine answer may legitimately begin with whitespace.
  const ws = sawBanner ? rest.length - rest.replace(/^\s+/, "").length : 0;
  return { body: rest.slice(ws), settled: true, start: offset + ws };
}

/** Split a resolved model id ("openai-codex/gpt-5.5") into provider + id. */
function splitModel(model?: string): { provider?: string; id?: string } {
  if (!model) return {};
  const slash = model.indexOf("/");
  if (slash === -1) return { id: model };
  return { provider: model.slice(0, slash), id: model.slice(slash + 1) };
}

export interface SandboxAgentOtelInit extends Omit<
  Partial<RunConfig>,
  "authorization" | "serializedBatchTransport"
> {
  /**
   * Authorization for the OTLP exporter. The runner supplies a provider so a long-lived turn
   * uses the latest session credential when it exports. A string remains accepted for local
   * callers and focused tests.
   */
  authorization?: string | AuthorizationProvider;
  captureContent?: boolean;
  /** Harness id ("pi" / "claude"); becomes gen_ai.agent.name. */
  harness?: string;
  /** Resolved model id ("openai-codex/gpt-5.5"); set on the LLM span. */
  model?: string;
  /**
   * Skill names actually materialized for this run — BOTH the author-supplied skills and the
   * forced Agenta platform `_agenta.*` skills the server injected. Stamped on the agent span so
   * a trace shows which skills loaded (F-029), not just the author config echoed elsewhere.
   */
  skills?: string[];
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
  /** End all open spans. Returns the accumulated assistant text. `stopReason` (e.g. "paused")
   *  is stamped on the terminal `done` record so hydration can distinguish a pause from a boundary. */
  finish(stopReason?: string): string;
  /**
   * Record a run-level error on the agent span: the user-facing message (F-030) plus the
   * provider that failed, and an OTel exception event, so a trace carries the same diagnostic
   * the HTTP response does (it previously showed only an error COUNT). Call before finish/flush.
   */
  recordError(message: string, provider?: string): void;
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
  /** Settle open tool calls except those intentionally left pending. */
  settleOpenToolCalls(
    isExcluded: (id: string) => boolean,
    message: string,
  ): void;
  /** Snapshot the ids whose tool calls have no terminal result yet. */
  openToolCallIds(): string[];
  /**
   * Mark a tool-call id as DENIED (the runner replied `reject` to its gate). Its closing failed
   * result then carries `denied: true` so the egress projects `tool-output-denied` (a decline)
   * rather than `tool-output-error` (a breakage). No-op for a falsy id.
   */
  markToolCallDenied(toolCallId: string | undefined): void;
  /** Run token/cost totals from the stream, when the harness reported `usage_update`. */
  usage(): AgentUsage | undefined;
}

/**
 * Build an ACP-event-driven tracer scoped to a single sandbox-agent run. Call `start` once,
 * `handleUpdate` for every ACP session update, then `finish` + `await flush`.
 */
export function createSandboxAgentOtel(
  init: SandboxAgentOtelInit,
): SandboxAgentOtel {
  ensureProvider();

  const capture = init.captureContent !== false;
  const emitSpans = init.emitSpans !== false;
  const endpoint = init.endpoint ?? defaultTarget().endpoint;
  // A run whose request carries no authorization header resolves to an empty value, not to
  // undefined. The shared provider keeps runner and Pi export behavior identical.
  const authorization = platformAuthorizationProvider(init.authorization);
  const { provider, id: modelId } = splitModel(init.model);
  const tracer = trace.getTracer("agenta-sandbox-agent-otel", "0.1.0");
  const runId = mintRunId();
  const streamTrace = createStreamTrace({ harness: init.harness });

  let agentSpan: Span | undefined;
  let agentCtx: Context | undefined;
  let turnSpan: Span | undefined;
  let turnCtx: Context | undefined;
  let llmSpan: Span | undefined;
  let runTraceId: string | undefined;
  let standaloneErrorRecorded = false;
  let accumulated = "";
  let reasoningAccumulated = "";
  let usage: AgentUsage | undefined;
  const events: AgentEvent[] = [];
  // `inputJson` is the serialized form of the last-RECORDED input for the call, so a later
  // `tool_call_update` can refresh the recorded args whenever they genuinely change.
  const toolSpans = new Map<
    string,
    { span?: Span; name: string; inputJson?: string }
  >();
  // Tool-call ids the runner replied `reject` to for a HITL deny. The harness closes such a call
  // as a FAILED tool call (`isError`), indistinguishable on the wire from a real breakage, so the
  // deny mapping records the id here and `maybeCloseTool` stamps the closing result `denied`.
  const deniedToolCallIds = new Set<string>();

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
  // Streaming banner suppression: pi-acp emits its startup banner as the FIRST agent message
  // chunk, ahead of the real answer. The one-shot `finish()` path strips it from the coalesced
  // text, but the streaming path flushes deltas as they arrive, before finish() ever runs — so
  // the banner would leak to the client. We hold the leading deltas until the banner region is
  // resolved (it may straddle chunk boundaries), then stream only the body past it. Once a real
  // line has started, `bannerSettled` latches true and we never strip again.
  let bannerSettled = false;
  // Once the banner region resolves, the real answer begins at this byte offset in `accumulated`;
  // every later chunk is streamed as `accumulated.slice(bannerEnd)` so the banner never reappears.
  let bannerEnd = 0;
  let reasoningBlockId: string | undefined;
  let reasoningEmitted = "";
  let blockSeq = 0;
  const nextId = (prefix: string): string => `${prefix}-${blockSeq++}`;

  function closeText(): void {
    if (textBlockId === undefined) return;
    record({ type: "message_end", id: textBlockId });
    textBlockId = undefined;
    streamTrace?.closeBlock("message");
  }

  function closeReasoning(): void {
    if (reasoningBlockId === undefined) return;
    record({ type: "thought_end", id: reasoningBlockId });
    reasoningBlockId = undefined;
    streamTrace?.closeBlock("thought");
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

  /**
   * Stream the assistant text for the cumulative `accumulated`, with the leading startup banner
   * suppressed. Until the banner region resolves we emit nothing; afterwards we stream the body
   * past it. `body` is a prefix-growing view of the real answer, so `streamText`'s delta logic
   * stays correct.
   */
  function streamAssistantText(): void {
    if (bannerSettled) {
      // The banner is a stable leading prefix; stream everything past it.
      streamText(accumulated.slice(bannerEnd));
      return;
    }
    const { body, settled, start } = splitLeadingBanner(accumulated);
    if (!settled) return; // banner region still arriving — hold emission
    bannerSettled = true;
    bannerEnd = start;
    if (body) streamText(body);
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
      record({ type: "thought_start", id: reasoningBlockId });
    }
    record({ type: "thought_delta", id: reasoningBlockId, delta });
    reasoningEmitted = target.startsWith(reasoningEmitted)
      ? target
      : reasoningEmitted + delta;
  }

  function start(input: {
    prompt?: string;
    messages?: any[];
    sessionId?: string;
  }): void {
    // Span-less mode (harness self-instruments): only track the trace id so the run can
    // report it; the harness emits the spans under the propagated parent.
    if (!emitSpans) {
      const m = /^00-([0-9a-f]{32})-/.exec(init.traceparent ?? "");
      runTraceId = m ? m[1] : undefined;
      return;
    }
    // Tag the run id onto the start context BEFORE creating the root span, so onStart
    // attributes invoke_agent itself (and every descendant) to this run.
    const parent = withRunId(
      parentContext(init.traceparent) ?? context.active(),
      runId,
    );
    agentSpan = tracer.startSpan("invoke_agent", undefined, parent);
    agentSpan.setAttribute("openinference.span.kind", "AGENT");
    agentSpan.setAttribute("gen_ai.operation.name", "invoke_agent");
    agentSpan.setAttribute("gen_ai.agent.name", init.harness ?? "agent");
    // F-029/F-036: stamp the skills that actually materialized so a trace shows which skills
    // loaded (not just the author config echoed on the workflow span), under the recognized
    // `ag.meta.*` namespace. Agenta's OTel ingest strict-whitelists top-level `ag.*` keys and
    // relocates unrecognized ones (an `ag.agent.*` key) to `ag.unsupported.*`; `ag.meta` is a
    // free-form recognized bucket, the same place run/request metadata already lands.
    if (init.skills && init.skills.length > 0) {
      agentSpan.setAttribute("ag.meta.skills.loaded", init.skills);
      agentSpan.setAttribute("ag.meta.skills.count", init.skills.length);
    }
    const sessionId = input.sessionId ?? init.sessionId;
    if (sessionId) {
      agentSpan.setAttribute("session.id", sessionId);
      agentSpan.setAttribute("gen_ai.conversation.id", sessionId);
    }
    setInputs(agentSpan, { prompt: input.prompt ?? "" }, capture);

    runTraceId = agentSpan.spanContext().traceId;
    registerRunTarget(runTraceId, runId, {
      kind: "http",
      endpoint,
      authorization,
    });
    if (init.redactor) registerRunRedactor(runTraceId, init.redactor);
    agentCtx = trace.setSpan(parent, agentSpan);

    turnSpan = tracer.startSpan("turn 0", undefined, agentCtx);
    turnSpan.setAttribute("openinference.span.kind", "CHAIN");
    turnSpan.setAttribute("pi.turn.index", 0);
    turnCtx = trace.setSpan(agentCtx, turnSpan);

    llmSpan = tracer.startSpan(
      modelId ? `chat ${modelId}` : "chat",
      undefined,
      turnCtx,
    );
    llmSpan.setAttribute("openinference.span.kind", "LLM");
    llmSpan.setAttribute("gen_ai.operation.name", "chat");
    if (provider) llmSpan.setAttribute("gen_ai.system", provider);
    if (modelId) llmSpan.setAttribute("gen_ai.request.model", modelId);
    if (init.harness === "codex" && modelId) {
      // Codex-only: codex-acp reports no response model and its ACP usage carries no cost, so stamp the
      // resolved model as the response model too; the platform cost calculator reads ag.meta.response.model.
      // Scoped to codex so other harnesses' cost source is unchanged.
      llmSpan.setAttribute("gen_ai.response.model", modelId);
    }
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
      const messageSnapshot = t.startsWith(accumulated);
      // Measure the NEW tail, not the chunk: a snapshot provider would otherwise report the
      // whole accumulated answer as this delta's size.
      streamTrace?.record(
        "message",
        messageSnapshot ? t.length - accumulated.length : t.length,
      );
      if (messageSnapshot) accumulated = t;
      else accumulated += t;
      // Live deltas run independent of span emission (text, not a span), so they flow even
      // when the harness self-instruments (emitSpans=false). `accumulated` is the cumulative
      // text, so the pure delta is its tail past what we already sent — minus the leading
      // startup banner, which is held back until the body begins (see streamAssistantText).
      if (sink) streamAssistantText();
      return;
    }

    if (kind === "agent_thought_chunk") {
      const t = acpBlockText(update.content);
      if (!t) return;
      const thoughtSnapshot = t.startsWith(reasoningAccumulated);
      streamTrace?.record(
        "thought",
        thoughtSnapshot ? t.length - reasoningAccumulated.length : t.length,
      );
      if (thoughtSnapshot) reasoningAccumulated = t;
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
      // Emit the tool_call up front — the FE tool part, the HITL approval part, and the loop
      // breaker all attach to it, so it MUST surface before any approval/result for this id.
      // Pi often announces the call with absent/`{}` args and fills them on a later
      // `tool_call_update`; we refresh the input there (see below), never by delaying this.
      record({
        type: "tool_call",
        id: String(id),
        name: String(name),
        input: update.rawInput,
      });
      toolSpans.set(id, {
        span,
        name: String(name),
        inputJson: toolInputJson(update.rawInput),
      });
      // A tool_call can arrive already completed (status set up front).
      maybeCloseTool(id, update);
      return;
    }

    if (kind === "tool_call_update") {
      // The real args often land here, not on the initial `tool_call` — and they can land
      // INCREMENTALLY: a harness may stream a growing partial parse of the args (Pi does:
      // `{}` -> `{x:[""]}` -> the full args), and the announcement itself may already carry
      // an early partial delta.
      // Refresh the recorded input whenever the update carries genuinely NEW args (serialized
      // compare against the last-recorded input), so the final recorded tool_call always has
      // the args the executor actually ran with — a refresh-once / had-args-at-announce gate
      // records an early partial delta as the call's input (the #5064 fold-path bug). The
      // egress projects a repeat tool_call for a seen id as an input refresh (no new
      // tool-input-start), mirroring the gated approval-refresh path.
      const id = update.toolCallId;
      const entry = id ? toolSpans.get(id) : undefined;
      if (entry && hasToolArgs(update.rawInput)) {
        const nextJson = toolInputJson(update.rawInput);
        if (nextJson !== entry.inputJson) {
          if (entry.span)
            setInputs(
              entry.span,
              update.rawInput as Record<string, unknown>,
              capture,
            );
          record({
            type: "tool_call",
            id: String(id),
            name: entry.name,
            input: update.rawInput,
          });
          entry.inputJson = nextJson;
        }
      }
      maybeCloseTool(id, update);
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
        total: typeof total === "number" ? total : (usage?.total ?? 0),
        cost: typeof cost === "number" ? cost : (usage?.cost ?? 0),
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
    const out =
      acpToolContentText(update.content) ||
      acpToolContentText(update.rawOutput) ||
      acpRawOutputText(update.rawOutput);
    if (entry.span) {
      setOutput(entry.span, out, capture);
      if (status === "failed")
        entry.span.setStatus({ code: SpanStatusCode.ERROR });
      entry.span.end();
    }
    toolSpans.delete(id);
    // A failed close for a call the runner denied is a decline, not a breakage: stamp `denied`
    // so the egress projects `tool-output-denied`. The set is consumed so a later reuse of the
    // id (should one ever occur) is not mis-flagged.
    const denied = status === "failed" && deniedToolCallIds.delete(id);
    record({
      type: "tool_result",
      id,
      output: out,
      isError: status === "failed",
      ...(denied ? { denied: true } : {}),
    });
  }

  function markToolCallDenied(toolCallId: string | undefined): void {
    if (toolCallId) deniedToolCallIds.add(toolCallId);
  }

  function settleOpenToolCalls(
    isExcluded: (id: string) => boolean,
    message: string,
  ): void {
    for (const [id, entry] of [...toolSpans.entries()]) {
      if (isExcluded(id)) continue;
      if (entry.span) {
        entry.span.setStatus({ code: SpanStatusCode.ERROR });
        entry.span.end();
      }
      toolSpans.delete(id);
      record({ type: "tool_result", id, output: message, isError: true });
    }
  }

  /**
   * Stamp a run-level error (the user-facing message + the provider that failed) and an OTel
   * exception event so a trace carries the same diagnostic the HTTP response does (F-030).
   *
   * Two cases:
   *  - This tracer owns the agent span (emitSpans=true: Claude / gateway / Daytona) — stamp it
   *    directly, before finish() ends it.
   *  - The harness self-instruments (emitSpans=false: Pi emits its own spans in another process)
   *    and no valid native batch was received — emit a standalone error
   *    span as a child of the caller's traceparent, so the error still reaches the /invoke trace.
   * The standalone fallback is idempotent and best-effort: a second call or a tracing failure
   * must never break the run.
   */
  function recordError(message: string, errorProvider?: string): void {
    const text = message || "agent run failed";
    const stamp = (span: Span): void => {
      // F-036: use the recognized `ag.exception.*` namespace (a free-form recognized bucket)
      // rather than `ag.error.*`, which Agenta's OTel ingest relocates to `ag.unsupported.*`
      // (unrecognized top-level `ag.*` key). `message` mirrors the OTel exception event below.
      span.setAttribute("ag.exception.message", text);
      const failedProvider = errorProvider ?? provider;
      if (failedProvider)
        span.setAttribute("ag.exception.provider", failedProvider);
      span.recordException({ name: "AgentRunError", message: text });
      span.setStatus({ code: SpanStatusCode.ERROR, message: text });
    };
    try {
      if (agentSpan) {
        stamp(agentSpan);
        return;
      }
      // No owned span (harness self-instruments). Emit one standalone error span under the
      // caller's traceparent so the failure is visible in the /invoke trace.
      if (standaloneErrorRecorded) return;
      standaloneErrorRecorded = true;
      // Tag the run id onto the start context first, same as the emitSpans=true root, so onStart
      // attributes this span to THIS run (concurrent runs may have different targets).
      const parent = withRunId(
        parentContext(init.traceparent) ?? context.active(),
        runId,
      );
      const errSpan = tracer.startSpan("agent_error", undefined, parent);
      errSpan.setAttribute("openinference.span.kind", "AGENT");
      errSpan.setAttribute("gen_ai.operation.name", "invoke_agent");
      errSpan.setAttribute("gen_ai.agent.name", init.harness ?? "agent");
      stampUsage(errSpan, usage);
      stamp(errSpan);
      // The standalone span shares the caller's trace id; make sure the run reports it so the
      // engine flushes this trace (a self-instrumenting run otherwise only tracked it from the
      // traceparent, which is the same id — but set it defensively if it was never resolved).
      runTraceId = runTraceId ?? errSpan.spanContext().traceId;
      registerRunTarget(runTraceId, runId, {
        kind: "http",
        endpoint,
        authorization,
      });
      // Register BEFORE end(): a root span with no in-process parent flushes synchronously
      // on end(), so the redactor/target must already be in their accumulators or this batch
      // escapes raw / falls back to the wrong target.
      if (init.redactor) registerRunRedactor(runTraceId, init.redactor);
      errSpan.end();
    } catch {
      // tracing must never break the run
    }
  }

  function finish(stopReason?: string): string {
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
    // Stamp the run's trace id on the turn's terminal event so a persisted transcript can link a
    // replayed turn back to its trace (undefined only in span-less mode with no valid traceparent).
    // Mark a paused turn's terminal record so a cold reload can tell a pause from a real turn
    // boundary (the FE adoption heuristic and hydration read this). A completed turn omits it.
    record({
      type: "done",
      ...(stopReason === "paused" ? { stopReason: "paused" } : {}),
      ...(runTraceId ? { traceId: runTraceId } : {}),
    });
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
    recordError,
    setUsage,
    flush: () => flushTrace(runTraceId, init.redactor, runId),
    traceId: () => runTraceId,
    output: () => accumulated,
    events: () => events,
    settleOpenToolCalls,
    openToolCallIds: () => [...toolSpans.keys()],
    markToolCallDenied,
    usage: () => usage,
  };
}
