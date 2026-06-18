/**
 * Gateway-trigger domain types.
 *
 * The triggers catalog API (WP1) is not yet in the Fern-generated client, so
 * the wire shapes are declared here as zod schemas mirroring the frozen
 * backend DTOs (`api/oss/src/core/triggers/dtos.py`,
 * `api/oss/src/apis/fastapi/triggers/models.py`). Validation runs at the API
 * boundary, exactly as `web/AGENTS.md` prescribes for the Fern path. When the
 * client is regenerated with a `triggers` resource these aliases swap to
 * `AgentaApi.*` mechanically.
 *
 * Connections are shared rows (WP0): the same `gateway_connections` surface
 * both `/tools/connections` and `/triggers/connections`. We reuse the
 * gatewayTool connection type so the two lists are byte-compatible (F2).
 */

import {z} from "zod"

import type {ToolConnection, ToolConnectionsResponse} from "../../gatewayTool/core/types"

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
// Connections — shared `gateway_connections` rows (WP0). Same shape as
// `/tools/connections`; the FE treats both lists as the same rows (F2). The TS
// type aliases the gatewayTool Fern type so the two lists are byte-compatible;
// the schema validates the axios boundary (the triggers client isn't Fern yet).
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

export type TriggerConnection = ToolConnection
export type TriggerConnectionsResponse = ToolConnectionsResponse

export {isConnectionActive, isConnectionValid} from "../../gatewayTool/core/types"
