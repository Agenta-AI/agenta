// Mirror of api/oss/src/core/gateways/mcps/dtos.py + apis/fastapi/gateways/mcps/models.py
// IMPORTANT: Do not add fields that don't exist in the backend.

export type MCPAuthMode = "oauth" | "api_key" | "none"
export type MCPEndpointNamespace = "builtin" | "standard" | "custom"

export interface MCPOAuthData {
    resource?: string | null
    authorization_server?: string | null
    scopes_offered?: string[]
}

export interface MCPEndpointRoute {
    base_url?: string | null
    headers?: Record<string, string> | null
}

export interface MCPToolFilter {
    include?: string[] | null
    exclude?: string[] | null
}

export interface MCPEndpointSettings {
    timeout_seconds?: number | null
}

export interface MCPEndpointData {
    route: MCPEndpointRoute
    tools?: MCPToolFilter
    settings?: MCPEndpointSettings
    oauth?: MCPOAuthData | null
}

export interface MCPEndpointFlags {
    is_active?: boolean
    is_valid?: boolean
}

export interface MCPEndpoint {
    id: string
    slug?: string | null
    name?: string | null
    description?: string | null
    auth_mode: MCPAuthMode
    namespace?: MCPEndpointNamespace
    secret_id?: string | null
    data: MCPEndpointData
    flags?: MCPEndpointFlags
}

export interface MCPEndpointCreate {
    slug?: string | null
    name?: string | null
    description?: string | null
    auth_mode: MCPAuthMode
    secret_id?: string | null
    data: MCPEndpointData
    flags?: MCPEndpointFlags
}

export interface MCPEndpointEdit {
    id: string
    name?: string | null
    description?: string | null
    auth_mode: MCPAuthMode
    secret_id?: string | null
    data: MCPEndpointData
    flags?: MCPEndpointFlags
}

export interface MCPEndpointResponse {
    count: number
    endpoint?: MCPEndpoint | null
}

export interface MCPEndpointsResponse {
    count: number
    endpoints: MCPEndpoint[]
}

export interface MCPConnectResponse {
    count: number
    redirect_url?: string | null
    scopes_offered?: string[]
}
