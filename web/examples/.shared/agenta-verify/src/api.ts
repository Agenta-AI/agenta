/**
 * Spike-verify API client — thin wrapper that delegates to `@agenta/sdk`'s
 * `traces.querySpans()` for production paths, while preserving an injectable
 * abstraction so unit tests can mock at the spike-verify boundary (not the
 * fetch layer).
 *
 *   ┌──────────────────────┐    queryByServiceName    ┌────────────────────┐
 *   │ AgentaApiClient      │ ───────────────────────▶ │ @agenta/sdk        │
 *   │ (this interface)     │                          │ init().traces      │
 *   │                      │   in production:         │  .querySpans()     │
 *   │                      │   uses the SDK           │                    │
 *   │                      │                          │ Fern-generated     │
 *   │                      │                          │ Agenta API client  │
 *   │                      │   in tests:              └────────────────────┘
 *   │                      │   stubbed (fake spans
 *   │                      │   returned synchronously)
 *   └──────────────────────┘
 *
 * Why a wrapper exists at all: the SDK returns SpanOutput shapes that nest
 * `attributes` as `Record<string, FullJsonOutput | null>`. The verifier needs
 * a normalized {name, attributes} shape to keep its assertion logic small and
 * self-contained. This wrapper does that translation in ONE place.
 */

import {init, type AgentaApiClient as SdkClient} from "@agenta/sdk"

export interface AgentaApiClient {
    /**
     * Query Agenta for spans whose attribute at `attributePath` equals
     * `attributeValue`. Returns a normalized shape regardless of the
     * underlying client.
     *
     * NOTE: `service.name` is NOT queryable on Agenta today (OTel Resource
     * attributes don't survive the adapter pipeline — captured as P-NODE-01).
     * Spike apps must filter on something they control per-call: `ag.user.id`
     * or `ag.session.id` set to a unique-per-run value, typically.
     */
    queryByAttribute(
        attributePath: string,
        attributeValue: string,
    ): Promise<{
        httpStatus: number
        bodySnippet: string | null
        spans: AgentaSpan[]
    }>
}

/**
 * Normalized span shape used internally by the verifier. Maps the SDK's
 * `SpanOutput.span_name` to our `name` field for parity with span semantics
 * everywhere else (OTel, AI SDK, etc., all call it `name`).
 */
export interface AgentaSpan {
    name?: string
    span_id?: string
    trace_id?: string
    /** Flat attributes object (post-adapter `ag.*` keys). Values are JSON-ish. */
    attributes?: Record<string, unknown>
}

export interface AgentaApiOptions {
    /** Base URL, e.g. https://cloud.agenta.ai. Defaults to AGENTA_HOST env var. */
    host?: string
    /** API key. Defaults to AGENTA_API_KEY env var. */
    apiKey?: string
    /**
     * Project UUID. Agenta reads `project_id` from query params on every
     * request (NOT headers). Project-scoped API keys make this implicit,
     * but passing it explicitly is correct + self-documenting.
     *
     * NOTE: SDK's `init({projectId})` accepts this option but silently
     * ignores it (SDK-REQ-03 in status.md). We append it to `?project_id=` in the
     * request URL ourselves.
     */
    projectId?: string
    /** Inject a pre-constructed SDK client (used by tests that swap behavior). */
    sdkClient?: SdkClient
}

/**
 * Production client. Constructs (or wraps) the official `@agenta/sdk` client
 * and exposes the verify-friendly `queryByServiceName` method.
 */
export function createAgentaApiClient(opts: AgentaApiOptions = {}): AgentaApiClient {
    // The SDK's `AgentaApiEnvironment.Default` is "/api" — it assumes the host
    // string already includes the /api prefix when explicitly passed. Real
    // users will type just the origin (matches every .env.example everywhere),
    // so we normalize here. Captured as SDK-REQ-02 in status.md; the SDK
    // should accept either origin or origin+/api transparently.
    const sdk = opts.sdkClient ?? init({host: appendApiPrefix(opts.host), apiKey: opts.apiKey})

    // Project UUID gets threaded into every request as `?project_id=<uuid>`
    // because Agenta reads it from query params (NOT headers, NOT body).
    // SDK's init({projectId}) ignores it (SDK-REQ-03 in status.md), so we set per-call
    // queryParams on every request from here.
    const requestOptions = opts.projectId ? {queryParams: {project_id: opts.projectId}} : undefined

    return {
        async queryByAttribute(attributePath, attributeValue) {
            try {
                const result = await sdk.traces.querySpans(
                    {
                        filtering: {
                            operator: "and",
                            conditions: [
                                {
                                    field: "attributes",
                                    key: attributePath,
                                    value: attributeValue,
                                    operator: "is",
                                },
                            ],
                        },
                    },
                    requestOptions,
                )
                // SDK returns the response body unwrapped via HttpResponsePromise.
                const spans = (result.spans ?? []).map(normalizeSpan)
                return {
                    httpStatus: 200,
                    bodySnippet: snippet(
                        JSON.stringify({count: result.count, spans: spans.length}),
                    ),
                    spans,
                }
            } catch (err) {
                // Re-shape SDK errors into a uniform {httpStatus, body} payload so
                // the verifier's polling loop sees them the same as before.
                if (isAgentaApiError(err)) {
                    return {
                        httpStatus: err.statusCode ?? 0,
                        bodySnippet: snippet(safeStringify(err.body)) ?? snippet(err.message),
                        spans: [],
                    }
                }
                // Network / transport / unknown — let the polling layer treat as
                // a fetch failure (consecutive-failures path).
                throw err
            }
        },
    }
}

// --- helpers ---

/**
 * Normalize an Agenta host string for SDK consumption. Users typically set
 * AGENTA_HOST to an origin (e.g. https://cloud.agenta.ai) — matching the
 * .env.example shape everywhere. The Fern SDK, however, expects the API
 * mount path baked in (its `AgentaApiEnvironment.Default` is `/api`). Append
 * `/api` if it's missing. Idempotent.
 */
function appendApiPrefix(host: string | undefined): string | undefined {
    if (!host) return undefined
    const trimmed = host.endsWith("/") ? host.slice(0, -1) : host
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`
}

function normalizeSpan(s: {
    span_name?: string | null
    span_id?: string
    trace_id?: string
    attributes?: Record<string, unknown> | null
}): AgentaSpan {
    return {
        name: s.span_name ?? undefined,
        span_id: s.span_id,
        trace_id: s.trace_id,
        attributes: (s.attributes ?? undefined) as Record<string, unknown> | undefined,
    }
}

function snippet(text: string | null | undefined, max = 500): string | null {
    if (!text) return null
    return text.length > max ? `${text.slice(0, max)}…` : text
}

function safeStringify(v: unknown): string {
    try {
        return typeof v === "string" ? v : JSON.stringify(v)
    } catch {
        return String(v)
    }
}

function isAgentaApiError(
    err: unknown,
): err is {statusCode?: number; body?: unknown; message: string} {
    return Boolean(
        err &&
        typeof err === "object" &&
        "statusCode" in (err as Record<string, unknown>) &&
        "message" in (err as Record<string, unknown>),
    )
}
