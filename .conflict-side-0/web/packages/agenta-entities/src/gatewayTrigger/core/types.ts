/**
 * Gateway-trigger domain types.
 *
 * The triggers catalog API is not yet in the Fern-generated client, so the
 * wire shapes are declared here as zod schemas mirroring the backend DTOs
 * (`api/oss/src/core/triggers/dtos.py`,
 * `api/oss/src/apis/fastapi/triggers/models.py`). Validation runs at the API
 * boundary. Connections are shared `gateway_connections` rows, so the
 * gatewayTool connection type is reused to keep both lists byte-compatible.
 */

import {z} from "zod"

import type {
    ToolConnection,
    ToolConnectionCreatePayload,
    ToolConnectionResponse,
    ToolConnectionsResponse,
} from "../../gatewayTool/core/types"

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const triggerProviderKindSchema = z.enum(["composio"])
export type TriggerProviderKind = z.infer<typeof triggerProviderKindSchema>

export const triggerCatalogProviderSchema = z
    .object({
        key: triggerProviderKindSchema,
        name: z.string(),
        description: z.string().nullish(),
    })
    .passthrough()
export type TriggerCatalogProvider = z.infer<typeof triggerCatalogProviderSchema>

export const triggerCatalogEventSchema = z
    .object({
        key: z.string(),
        name: z.string(),
        description: z.string().nullish(),
        provider: z.string().nullish(),
        integration: z.string().nullish(),
        categories: z.array(z.string()).default([]),
        logo: z.string().nullish(),
    })
    .passthrough()
export type TriggerCatalogEvent = z.infer<typeof triggerCatalogEventSchema>

export const triggerCatalogEventDetailsSchema = triggerCatalogEventSchema.extend({
    trigger_config: z.record(z.string(), z.unknown()).nullish(),
    payload: z.record(z.string(), z.unknown()).nullish(),
})
export type TriggerCatalogEventDetails = z.infer<typeof triggerCatalogEventDetailsSchema>

export const triggerCatalogProvidersResponseSchema = z
    .object({
        count: z.number().default(0),
        providers: z.array(triggerCatalogProviderSchema).default([]),
    })
    .passthrough()
export type TriggerCatalogProvidersResponse = z.infer<typeof triggerCatalogProvidersResponseSchema>

export const triggerCatalogProviderResponseSchema = z
    .object({
        count: z.number().default(0),
        provider: triggerCatalogProviderSchema.nullish(),
    })
    .passthrough()
export type TriggerCatalogProviderResponse = z.infer<typeof triggerCatalogProviderResponseSchema>

// Integrations — SHARED catalog with tools (gateway/catalog); browsed
// independently from `/triggers/catalog/.../integrations/`.
export const triggerCatalogIntegrationSchema = z
    .object({
        key: z.string(),
        name: z.string(),
        description: z.string().nullish(),
        categories: z.array(z.string()).default([]),
        logo: z.string().nullish(),
        url: z.string().nullish(),
        actions_count: z.number().nullish(),
        auth_schemes: z.array(z.string()).nullish(),
    })
    .passthrough()
export type TriggerCatalogIntegration = z.infer<typeof triggerCatalogIntegrationSchema>

export const triggerCatalogIntegrationsResponseSchema = z
    .object({
        count: z.number().default(0),
        total: z.number().default(0),
        cursor: z.string().nullish(),
        integrations: z.array(triggerCatalogIntegrationSchema).default([]),
    })
    .passthrough()
export type TriggerCatalogIntegrationsResponse = z.infer<
    typeof triggerCatalogIntegrationsResponseSchema
>

export const triggerCatalogIntegrationResponseSchema = z
    .object({
        count: z.number().default(0),
        integration: triggerCatalogIntegrationSchema.nullish(),
    })
    .passthrough()
export type TriggerCatalogIntegrationResponse = z.infer<
    typeof triggerCatalogIntegrationResponseSchema
>

export const triggerCatalogEventsResponseSchema = z
    .object({
        count: z.number().default(0),
        total: z.number().default(0),
        cursor: z.string().nullish(),
        events: z.array(triggerCatalogEventSchema).default([]),
    })
    .passthrough()
export type TriggerCatalogEventsResponse = z.infer<typeof triggerCatalogEventsResponseSchema>

export const triggerCatalogEventResponseSchema = z
    .object({
        count: z.number().default(0),
        event: triggerCatalogEventDetailsSchema.nullish(),
    })
    .passthrough()
export type TriggerCatalogEventResponse = z.infer<typeof triggerCatalogEventResponseSchema>

// ---------------------------------------------------------------------------
// Connections — shared `gateway_connections` rows. The TS type aliases the
// gatewayTool Fern type so both lists are byte-compatible; the schema validates
// the axios boundary (the triggers client isn't Fern yet).
// ---------------------------------------------------------------------------

const jsonRecordSchema = z.record(z.string(), z.unknown()).nullish()

export const triggerConnectionSchema = z
    .object({
        flags: jsonRecordSchema,
        tags: jsonRecordSchema,
        meta: jsonRecordSchema,
        created_at: z.string().nullish(),
        updated_at: z.string().nullish(),
        deleted_at: z.string().nullish(),
        created_by_id: z.string().nullish(),
        updated_by_id: z.string().nullish(),
        deleted_by_id: z.string().nullish(),
        name: z.string().nullish(),
        description: z.string().nullish(),
        slug: z.string().nullish(),
        id: z.string().nullish(),
        provider_key: z.string(),
        integration_key: z.string(),
        data: jsonRecordSchema,
        status: z.unknown().nullish(),
    })
    .passthrough()

export const triggerConnectionsResponseSchema = z
    .object({
        count: z.number().default(0),
        connections: z.array(triggerConnectionSchema).default([]),
    })
    .passthrough()

export const triggerConnectionResponseSchema = z
    .object({
        count: z.number().default(0),
        connection: triggerConnectionSchema.nullish(),
    })
    .passthrough()

export type TriggerConnection = ToolConnection
export type TriggerConnectionsResponse = ToolConnectionsResponse
// Write surface reuses the gatewayTool shapes: independent endpoint, identical payload.
export type TriggerConnectionResponse = ToolConnectionResponse
export type TriggerConnectionCreatePayload = ToolConnectionCreatePayload

export {isConnectionActive, isConnectionValid} from "../../gatewayTool/core/types"

// ---------------------------------------------------------------------------
// Subscriptions — a standing watch binding a provider event to a workflow.
// Mirrors the backend DTOs (`api/oss/src/core/triggers/dtos.py`). Validated at
// the axios boundary.
// ---------------------------------------------------------------------------

// A workflow reference (the /retrieve shape): {id, slug?, version?}.
export const triggerReferenceSchema = z
    .object({
        id: z.string().nullish(),
        slug: z.string().nullish(),
        version: z.string().nullish(),
    })
    .passthrough()
export type TriggerReference = z.infer<typeof triggerReferenceSchema>

export const triggerSelectorSchema = z
    .object({
        key: z.string().nullish(),
        path: z.string().nullish(),
    })
    .passthrough()
export type TriggerSelector = z.infer<typeof triggerSelectorSchema>

// Start/stop state lives in `flags.is_active` / `flags.is_valid`.
export const triggerSubscriptionFlagsSchema = z
    .object({
        is_active: z.boolean().default(true),
        is_valid: z.boolean().default(true),
        // Capture-and-skip mode: events recorded as test deliveries, no workflow run.
        is_test: z.boolean().default(false),
    })
    .passthrough()
export type TriggerSubscriptionFlags = z.infer<typeof triggerSubscriptionFlagsSchema>

export const triggerSubscriptionDataSchema = z
    .object({
        event_key: z.string(),
        trigger_config: z.record(z.string(), z.unknown()).nullish(),
        // Object (field-by-field) or a bare selector string (e.g. "$" = whole context).
        inputs_fields: z.union([z.record(z.string(), z.unknown()), z.string()]).nullish(),
        references: z.record(z.string(), triggerReferenceSchema).nullish(),
        selector: triggerSelectorSchema.nullish(),
    })
    .passthrough()
export type TriggerSubscriptionData = z.infer<typeof triggerSubscriptionDataSchema>

export const triggerSubscriptionSchema = z
    .object({
        id: z.string().nullish(),
        slug: z.string().nullish(),
        name: z.string().nullish(),
        description: z.string().nullish(),
        tags: jsonRecordSchema,
        meta: jsonRecordSchema,
        created_at: z.string().nullish(),
        updated_at: z.string().nullish(),
        deleted_at: z.string().nullish(),
        created_by_id: z.string().nullish(),
        updated_by_id: z.string().nullish(),
        deleted_by_id: z.string().nullish(),
        connection_id: z.string(),
        trigger_id: z.string().nullish(),
        data: triggerSubscriptionDataSchema,
        flags: triggerSubscriptionFlagsSchema.nullish(),
    })
    .passthrough()
export type TriggerSubscription = z.infer<typeof triggerSubscriptionSchema>

export const triggerSubscriptionResponseSchema = z
    .object({
        count: z.number().default(0),
        subscription: triggerSubscriptionSchema.nullish(),
    })
    .passthrough()
export type TriggerSubscriptionResponse = z.infer<typeof triggerSubscriptionResponseSchema>

export const triggerSubscriptionsResponseSchema = z
    .object({
        count: z.number().default(0),
        subscriptions: z.array(triggerSubscriptionSchema).default([]),
    })
    .passthrough()
export type TriggerSubscriptionsResponse = z.infer<typeof triggerSubscriptionsResponseSchema>

// Create body (Header + Metadata + connection_id + data); no id.
export interface TriggerSubscriptionCreate {
    name?: string | null
    description?: string | null
    flags?: Record<string, unknown> | null
    tags?: Record<string, unknown> | null
    meta?: Record<string, unknown> | null
    connection_id: string
    data: TriggerSubscriptionData
}

// Edit body — full PUT: Identifier + Header + Metadata + connection_id + data + flags.
export interface TriggerSubscriptionEdit extends TriggerSubscriptionCreate {
    id: string
    flags: {is_active: boolean; is_valid: boolean; is_test?: boolean} & Record<string, unknown>
}

export interface TriggerSubscriptionQuery {
    name?: string
    connection_id?: string
    event_key?: string
}

// ---------------------------------------------------------------------------
// Deliveries — read-only audit rows, one per inbound event dispatched.
// Mirrors `TriggerDelivery` / `TriggerDeliveryQuery`. `status` is the shared
// `core.shared.dtos.Status` (timestamp/type/code/message/stacktrace).
// ---------------------------------------------------------------------------

export const triggerStatusSchema = z
    .object({
        timestamp: z.string().nullish(),
        type: z.string().nullish(),
        code: z.string().nullish(),
        message: z.string().nullish(),
        stacktrace: z.string().nullish(),
    })
    .passthrough()
export type TriggerStatus = z.infer<typeof triggerStatusSchema>

export const triggerDeliveryDataSchema = z
    .object({
        event_key: z.string().nullish(),
        references: z.record(z.string(), triggerReferenceSchema).nullish(),
        inputs: z.record(z.string(), z.unknown()).nullish(),
        result: z.record(z.string(), z.unknown()).nullish(),
        error: z.string().nullish(),
        // Set on capture-and-skip deliveries from an is_test subscription.
        is_test: z.boolean().nullish(),
    })
    .passthrough()
export type TriggerDeliveryData = z.infer<typeof triggerDeliveryDataSchema>

export const triggerDeliverySchema = z
    .object({
        id: z.string().nullish(),
        slug: z.string().nullish(),
        created_at: z.string().nullish(),
        updated_at: z.string().nullish(),
        deleted_at: z.string().nullish(),
        created_by_id: z.string().nullish(),
        updated_by_id: z.string().nullish(),
        deleted_by_id: z.string().nullish(),
        status: triggerStatusSchema,
        data: triggerDeliveryDataSchema.nullish(),
        // XOR (DB-enforced): a delivery belongs to a subscription OR a schedule.
        subscription_id: z.string().nullish(),
        schedule_id: z.string().nullish(),
        event_id: z.string(),
    })
    .passthrough()
export type TriggerDelivery = z.infer<typeof triggerDeliverySchema>

export const triggerDeliveryResponseSchema = z
    .object({
        count: z.number().default(0),
        delivery: triggerDeliverySchema.nullish(),
    })
    .passthrough()
export type TriggerDeliveryResponse = z.infer<typeof triggerDeliveryResponseSchema>

export const triggerDeliveriesResponseSchema = z
    .object({
        count: z.number().default(0),
        deliveries: z.array(triggerDeliverySchema).default([]),
    })
    .passthrough()
export type TriggerDeliveriesResponse = z.infer<typeof triggerDeliveriesResponseSchema>

export interface TriggerDeliveryQuery {
    status?: TriggerStatus
    subscription_id?: string
    schedule_id?: string
    event_id?: string
}

// ---------------------------------------------------------------------------
// Schedules — a standing cron timer binding a recurring tick to a workflow.
// Mirrors the backend DTOs (`api/oss/src/core/triggers/dtos.py`). A schedule
// has no connection — it fires on its own UTC 5-field cron clock, so
// `flags.is_active` is the only lifecycle flag (no `is_valid`). Validated at
// the axios boundary.
// ---------------------------------------------------------------------------

export const triggerScheduleFlagsSchema = z
    .object({
        is_active: z.boolean().default(true),
    })
    .passthrough()
export type TriggerScheduleFlags = z.infer<typeof triggerScheduleFlagsSchema>

export const triggerScheduleDataSchema = z
    .object({
        event_key: z.string(),
        // 5-field cron expression, UTC, validated client-side via the local helper.
        schedule: z.string(),
        // Optional UTC window bounds; ISO strings, [start_time, end_time).
        start_time: z.string().nullish(),
        end_time: z.string().nullish(),
        // Object (field-by-field) or a bare selector string (e.g. "$" = whole context).
        inputs_fields: z.union([z.record(z.string(), z.unknown()), z.string()]).nullish(),
        references: z.record(z.string(), triggerReferenceSchema).nullish(),
        selector: triggerSelectorSchema.nullish(),
    })
    .passthrough()
export type TriggerScheduleData = z.infer<typeof triggerScheduleDataSchema>

export const triggerScheduleSchema = z
    .object({
        id: z.string().nullish(),
        slug: z.string().nullish(),
        name: z.string().nullish(),
        description: z.string().nullish(),
        flags: triggerScheduleFlagsSchema.nullish(),
        tags: jsonRecordSchema,
        meta: jsonRecordSchema,
        created_at: z.string().nullish(),
        updated_at: z.string().nullish(),
        deleted_at: z.string().nullish(),
        created_by_id: z.string().nullish(),
        updated_by_id: z.string().nullish(),
        deleted_by_id: z.string().nullish(),
        data: triggerScheduleDataSchema,
    })
    .passthrough()
export type TriggerSchedule = z.infer<typeof triggerScheduleSchema>

export const triggerScheduleResponseSchema = z
    .object({
        count: z.number().default(0),
        schedule: triggerScheduleSchema.nullish(),
    })
    .passthrough()
export type TriggerScheduleResponse = z.infer<typeof triggerScheduleResponseSchema>

export const triggerSchedulesResponseSchema = z
    .object({
        count: z.number().default(0),
        schedules: z.array(triggerScheduleSchema).default([]),
    })
    .passthrough()
export type TriggerSchedulesResponse = z.infer<typeof triggerSchedulesResponseSchema>

// Create body (Header + Metadata + data); no id, no connection_id.
export interface TriggerScheduleCreate {
    name?: string | null
    description?: string | null
    flags?: Record<string, unknown> | null
    tags?: Record<string, unknown> | null
    meta?: Record<string, unknown> | null
    data: TriggerScheduleData
}

// Edit body — full PUT: Identifier + Header + Metadata + data + flags.
export interface TriggerScheduleEdit extends TriggerScheduleCreate {
    id: string
    flags: {is_active: boolean} & Record<string, unknown>
}

export interface TriggerScheduleQuery {
    name?: string
    event_key?: string
}

// ---------------------------------------------------------------------------
// Shared flag readers. These accept any of the three lifecycle entities
// (trigger subscription, trigger schedule, webhook subscription) which all
// expose the same `flags.is_active` shape.
// ---------------------------------------------------------------------------

/** Read `flags.is_active`, defaulting to `true` when the flag is absent. */
export function isEntityActive(entity?: {flags?: Record<string, unknown> | null} | null): boolean {
    const raw = entity?.flags?.is_active
    return raw === undefined || raw === null ? true : Boolean(raw)
}

/**
 * Read `flags.is_valid`, defaulting to `true` when the flag is absent. Only
 * trigger/webhook subscriptions carry validity (schedules have no external
 * connection, so they have no `is_valid`).
 */
export function isEntityValid(entity?: {flags?: Record<string, unknown> | null} | null): boolean {
    const raw = entity?.flags?.is_valid
    return raw === undefined || raw === null ? true : Boolean(raw)
}
