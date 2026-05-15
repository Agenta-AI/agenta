// Domain types for the gateway-tool entity.
//
// Lifted from `web/oss/src/services/tools/api/types.ts` so consumers can
// migrate off the OSS service-layer without changing shapes. Mirrors the
// FastAPI models in `api/oss/src/apis/fastapi/tools/models.py`.
//
// These hand-written shapes intentionally differ from the Fern-generated
// `ToolConnection` / `ToolCatalogIntegration` types in two ways:
//   1. They are tighter (e.g. `flags?: {is_active?: boolean; is_valid?: boolean}`
//      vs Fern's wider `Record<string, LabelJsonOutput | null>`).
//   2. They use camelCase nowhere — every key matches the wire format.
// The runtime payload is identical, so api/api.ts casts Fern responses
// to these types at the boundary.

// ---------------------------------------------------------------------------
// Catalog browse
// ---------------------------------------------------------------------------

export interface ProviderItem {
    key: string
    name: string
    description?: string
    integrations_count?: number
}

export interface ProvidersResponse {
    count: number
    providers: ProviderItem[]
}

export type ToolAuthScheme = "oauth" | "api_key"

export interface IntegrationItem {
    key: string
    name: string
    description?: string
    logo?: string
    url?: string
    actions_count?: number
    categories: string[]
    auth_schemes?: ToolAuthScheme[]
}

export interface IntegrationsResponse {
    count: number
    total: number
    cursor?: string | null
    integrations: IntegrationItem[]
}

export interface IntegrationDetailResponse {
    count: number
    integration: IntegrationItem | null
}

export interface ActionItem {
    key: string
    name: string
    description?: string
    categories?: string[]
    logo?: string
}

export interface ActionDetailItem extends ActionItem {
    schemas?: {
        inputs?: Record<string, unknown>
        outputs?: Record<string, unknown>
    }
    scopes?: string[]
}

export interface ActionsListResponse {
    count: number
    total: number
    cursor?: string | null
    actions: ActionItem[]
}

export interface ActionDetailResponse {
    count: number
    action: ActionDetailItem | null
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface ConnectionItem {
    id: string
    slug: string
    name?: string
    description?: string
    provider_key: string
    integration_key: string
    flags?: {is_active?: boolean; is_valid?: boolean}
    status?: Record<string, unknown>
    data?: Record<string, unknown>
    created_at?: string
    updated_at?: string
}

export interface ConnectionCreateRequest {
    connection: {
        slug: string
        name?: string
        description?: string
        provider_key: string
        integration_key: string
        data?: {
            auth_scheme?: ToolAuthScheme
            credentials?: Record<string, string>
        }
    }
}

export interface ConnectionResponse {
    count: number
    connection: ConnectionItem | null
}

export interface ConnectionsQueryResponse {
    count: number
    connections: ConnectionItem[]
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ToolCallFunction {
    name: string // slug: tools__{provider}__{integration}__{action}__{connection}
    arguments: string | Record<string, unknown> // JSON string (as LLM returns) or parsed dict
}

export interface ToolCallData {
    id: string // LLM call ID (e.g. "call_zEoV...")
    type?: string
    function: ToolCallFunction
}

/** Request — wraps the raw OpenAI tool call verbatim. */
export interface ToolCallRequest {
    data: ToolCallData
}

export interface ToolResultData {
    role: string // "tool"
    tool_call_id: string // echoed from ToolCallData.id
    content: string // execution result as JSON string
}

export interface Status {
    timestamp: string // ISO datetime
    type: string // "ok" | "error"
    code?: string
    message?: string
    stacktrace?: string
}

/** Response — Agenta envelope with identity, status, and the OpenAI tool message. */
export interface ToolCallResult {
    id?: string // Agenta UUID
    status?: Status
    data?: ToolResultData
}

export interface ToolCallResponse {
    call: ToolCallResult
}
