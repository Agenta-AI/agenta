/**
 * Agenta TypeScript SDK — Tracing manager.
 *
 * Query spans and traces from the observability layer.
 *
 * Endpoints (new /preview API):
 *   POST /preview/spans/query   → querySpans
 *   POST /preview/traces/query  → queryTraces
 *   GET  /preview/spans/        → listSpans
 *   GET  /preview/traces/       → listTraces
 *   GET  /preview/spans/:traceId/:spanId → getSpan
 *   GET  /preview/traces/:traceId        → getTrace
 *
 * Legacy endpoints (no /preview prefix):
 *   POST /tracing/spans/query   → querySpans  (legacy: true)
 *   POST /tracing/traces/query  → queryTraces (legacy: true)
 */

import {schemas, validateBoundary, type SchemaOf} from "./.generated/index"
import type {AgentaClient} from "./client"
import type {
    Filtering,
    Windowing,
    Reference,
    SpansQueryRequest,
    TracesQueryRequest,
    OTelTracingResponse,
} from "./types"

export class Tracing {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Query spans with structured filtering and pagination.
     */
    async querySpans(options?: {
        filtering?: Filtering
        windowing?: Windowing
        queryRef?: Reference
        queryVariantRef?: Reference
        queryRevisionRef?: Reference
    }): Promise<OTelTracingResponse> {
        const body: SpansQueryRequest = {
            filtering: options?.filtering,
            windowing: options?.windowing,
            query_ref: options?.queryRef,
            query_variant_ref: options?.queryVariantRef,
            query_revision_ref: options?.queryRevisionRef,
        }
        return this.client.post<OTelTracingResponse>("/spans/query", body)
    }

    /**
     * Query traces with structured filtering and pagination.
     */
    async queryTraces(options?: {
        filtering?: Filtering
        windowing?: Windowing
        queryRef?: Reference
        queryVariantRef?: Reference
        queryRevisionRef?: Reference
    }): Promise<OTelTracingResponse> {
        const body: TracesQueryRequest = {
            filtering: options?.filtering,
            windowing: options?.windowing,
            query_ref: options?.queryRef,
            query_variant_ref: options?.queryVariantRef,
            query_revision_ref: options?.queryRevisionRef,
        }
        return this.client.post<OTelTracingResponse>("/traces/query", body)
    }

    /**
     * List all traces (GET /preview/traces/).
     */
    async listTraces(): Promise<OTelTracingResponse> {
        return this.client.get<OTelTracingResponse>("/traces/")
    }

    /**
     * List all spans (GET /preview/spans/).
     */
    async listSpans(): Promise<OTelTracingResponse> {
        return this.client.get<OTelTracingResponse>("/spans/")
    }

    /**
     * Get a single trace by ID (GET /preview/traces/:traceId).
     */
    async getTrace(traceId: string): Promise<unknown> {
        return this.client.get(`/traces/${traceId}`)
    }

    /**
     * Get a single span by trace and span ID (GET /preview/spans/:traceId/:spanId).
     */
    async getSpan(traceId: string, spanId: string): Promise<unknown> {
        return this.client.get(`/spans/${traceId}/${spanId}`)
    }

    /**
     * Delete a trace by ID.
     */
    async deleteTrace(traceId: string): Promise<unknown> {
        return this.client.delete(`/tracing/traces/${traceId}`, {legacy: true})
    }

    /**
     * Query tracing sessions for an application.
     */
    async querySessions(options: {
        applicationId: string
        filtering?: Filtering
        windowing?: Windowing
    }): Promise<SchemaOf<"SessionIdsResponse">> {
        const body = {
            filtering: options.filtering,
            windowing: options.windowing,
        }
        const raw = await this.client.post("/tracing/sessions/query", body, {
            legacy: true,
            params: {application_id: options.applicationId},
        })
        return validateBoundary(raw, schemas.SessionIdsResponse, "Tracing.querySessions")
    }

    /**
     * Query tracing users for an application.
     *
     * Returns aggregate user-level data (user IDs, span counts, sessions per user).
     * Mirrors Python's observability.list_users.
     */
    async queryUsers(options: {
        applicationId: string
        filtering?: Filtering
        windowing?: Windowing
    }): Promise<SchemaOf<"UserIdsResponse">> {
        const body = {
            filtering: options.filtering,
            windowing: options.windowing,
        }
        const raw = await this.client.post("/tracing/users/query", body, {
            legacy: true,
            params: {application_id: options.applicationId},
        })
        return validateBoundary(raw, schemas.UserIdsResponse, "Tracing.queryUsers")
    }

    /**
     * Query trace-level analytics (counts, timing distributions, aggregations).
     * Body shape is loose pending DTO drift audit.
     */
    async queryAnalytics(request: Record<string, unknown>): Promise<SchemaOf<"AnalyticsResponse">> {
        const raw = await this.client.post("/tracing/analytics/query", request, {
            legacy: true,
        })
        return validateBoundary(raw, schemas.AnalyticsResponse, "Tracing.queryAnalytics")
    }

    /**
     * Compute span-level analytics (token usage, latencies, error rates).
     * Body shape is loose pending DTO drift audit.
     *
     * Backend hits the legacy `OldAnalyticsResponse` schema; we validate against
     * the modern `AnalyticsResponse` since the shape is a superset.
     */
    async spanAnalytics(request: Record<string, unknown>): Promise<SchemaOf<"AnalyticsResponse">> {
        const raw = await this.client.post("/tracing/spans/analytics", request, {
            legacy: true,
        })
        return validateBoundary(raw, schemas.AnalyticsResponse, "Tracing.spanAnalytics")
    }

    /**
     * Query traces by application ID.
     *
     * Convenience wrapper that filters on the `ag.refs.application.id` span attribute.
     * Traces store application references as `ag.refs.{entity}.{field}` attributes
     * (set by the SDK's TracingContext processor).
     */
    async queryByApplication(
        applicationId: string,
        options?: {
            windowing?: Windowing
            revisionId?: string
        },
    ): Promise<OTelTracingResponse> {
        const conditions: Record<string, unknown>[] = [
            {
                field: "ATTRIBUTES",
                key: "ag.refs.application.id",
                value: applicationId,
                operator: "eq",
            },
        ]

        if (options?.revisionId) {
            conditions.push({
                field: "ATTRIBUTES",
                key: "ag.refs.application_revision.id",
                value: options.revisionId,
                operator: "eq",
            })
        }

        return this.querySpans({
            filtering: {conditions},
            windowing: options?.windowing,
        })
    }
}
