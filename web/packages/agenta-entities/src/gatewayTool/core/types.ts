/**
 * Gateway-tool domain types.
 *
 * All wire shapes are taken directly from the Fern-generated client
 * (`@agentaai/api-client`) so that this package never drifts from the
 * backend OpenAPI definition. We re-export them under their Fern names so
 * downstream consumers can import everything from one place
 * (`@agenta/entities/gatewayTool`) without reaching into the api-client.
 *
 * Two small helpers (`isConnectionActive`, `isConnectionValid`) bridge the
 * gap between Fern's loosely-typed `ToolConnection.flags`
 * (`Record<string, LabelJsonOutput | null>`) and the boolean values the
 * backend actually puts in it.
 */

import type {AgentaApi} from "@agentaai/api-client"

// ---------------------------------------------------------------------------
// Catalog browse
// ---------------------------------------------------------------------------

export type ToolCatalogProvider = AgentaApi.ToolCatalogProvider
export type ToolCatalogProviderDetails = AgentaApi.ToolCatalogProviderDetails
export type ToolCatalogProviderResponse = AgentaApi.ToolCatalogProviderResponse
export type ToolCatalogProvidersResponse = AgentaApi.ToolCatalogProvidersResponse

export type ToolAuthScheme = AgentaApi.ToolAuthScheme
export type ToolProviderKind = AgentaApi.ToolProviderKind

export type ToolCatalogIntegration = AgentaApi.ToolCatalogIntegration
export type ToolCatalogIntegrationDetails = AgentaApi.ToolCatalogIntegrationDetails
export type ToolCatalogIntegrationResponse = AgentaApi.ToolCatalogIntegrationResponse
export type ToolCatalogIntegrationsResponse = AgentaApi.ToolCatalogIntegrationsResponse

export type ToolCatalogAction = AgentaApi.ToolCatalogAction
export type ToolCatalogActionDetails = AgentaApi.ToolCatalogActionDetails
export type ToolCatalogActionResponse = AgentaApi.ToolCatalogActionResponse
export type ToolCatalogActionsResponse = AgentaApi.ToolCatalogActionsResponse

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export type ToolConnection = AgentaApi.ToolConnection
export type ToolConnectionCreate = AgentaApi.ToolConnectionCreate
export type ToolConnectionCreateData = AgentaApi.ToolConnectionCreateData
export type ToolConnectionResponse = AgentaApi.ToolConnectionResponse
export type ToolConnectionsResponse = AgentaApi.ToolConnectionsResponse
export type ToolConnectionStatus = AgentaApi.ToolConnectionStatus

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export type ToolCall = AgentaApi.ToolCall
export type ToolCallData = AgentaApi.ToolCallData
export type ToolCallFunction = AgentaApi.ToolCallFunction
export type ToolCallResponse = AgentaApi.ToolCallResponse
export type ToolResult = AgentaApi.ToolResult
export type ToolResultData = AgentaApi.ToolResultData
export type Status = AgentaApi.Status

// ---------------------------------------------------------------------------
// Legacy API extension
//
// The backend accepts an additional `credentials` field inside the create-
// connection payload's `data` object (used by the API-key auth path), but
// the OpenAPI spec used by Fern doesn't model it yet. We extend the Fern
// type so existing flows compile; when the spec is updated this alias can
// be removed.
// ---------------------------------------------------------------------------

export type ToolConnectionCreatePayloadData = ToolConnectionCreateData & {
    credentials?: Record<string, string>
}

export interface ToolConnectionCreatePayload {
    connection: Omit<ToolConnectionCreate, "data"> & {
        data?: ToolConnectionCreatePayloadData | null
    }
}

// ---------------------------------------------------------------------------
// Connection flag accessors
//
// Fern types `ToolConnection.flags` as `Record<string, LabelJsonOutput | null>`
// because the backend model is open-ended. In practice the server only stores
// booleans there; these helpers do the cast in one place so call sites stay
// readable.
// ---------------------------------------------------------------------------

function readConnectionFlag(
    connection: ToolConnection | null | undefined,
    flag: string,
): boolean | undefined {
    const value = (connection?.flags as Record<string, unknown> | null | undefined)?.[flag]
    return typeof value === "boolean" ? value : undefined
}

export function isConnectionActive(connection: ToolConnection | null | undefined): boolean {
    return readConnectionFlag(connection, "is_active") ?? false
}

export function isConnectionValid(connection: ToolConnection | null | undefined): boolean {
    return readConnectionFlag(connection, "is_valid") ?? false
}
