export interface OrganizationFlags {
    is_demo: boolean
    is_personal: boolean
    allow_email: boolean
    allow_social: boolean
    allow_sso: boolean
    allow_root: boolean
    domains_only: boolean
    auto_join: boolean
}

export interface Org {
    id: string
    slug?: string
    name?: string
    description?: string
    flags: OrganizationFlags
    owner_id: string
}

export interface Workspace {
    id: string
    name: string
    description: string
    created_at: string
    updated_at: string
    organization: string
    type: "default"
    members: WorkspaceMember[]
}

export type OrgDetails = Org & {
    default_workspace: Workspace
    workspaces: string[]
}

export interface OrganizationFlagsUpdate {
    is_personal?: boolean
    is_demo?: boolean
    allow_email?: boolean
    allow_social?: boolean
    allow_sso?: boolean
    auto_join?: boolean
    domains_only?: boolean
    allow_root?: boolean
}

export interface OrganizationUpdatePayload {
    slug?: string
    name?: string
    description?: string
    flags?: OrganizationFlagsUpdate
}

export interface OrganizationDomain {
    id: string
    slug: string // The actual domain name (e.g., "company.com")
    name: string | null // Friendly name
    description: string | null
    organization_id: string
    token: string | null // Verification token (available for unverified domains, null for verified)
    flags: {
        is_verified?: boolean
    }
    created_at: string
    updated_at: string | null
}

export interface OrganizationProviderSettings {
    issuer_url?: string
    client_id?: string
    client_secret?: string
    authorization_endpoint?: string
    token_endpoint?: string
    userinfo_endpoint?: string
    scopes?: string[]
}

export interface OrganizationProvider {
    id: string
    slug: string
    organization_id: string
    name?: string | null
    description?: string | null
    // Backend serves free-form dicts (OrganizationProviderResponse.flags/settings).
    // `is_valid` = the test call authenticated; `is_active` = the provider is live. Both are
    // stamped false on create and rewritten on every test.
    flags: {
        is_valid?: boolean
        is_active?: boolean
    }
    settings: OrganizationProviderSettings
    created_at: string
    updated_at: string | null
}

export interface WorkspaceRole {
    role_description: string
    role_name: string
}

export interface WorkspaceUser {
    id: string
    email: string
    username: string
    status: "member" | "pending" | "expired"
    created_at: string
}

export interface WorkspaceMember {
    user: WorkspaceUser
    roles: (WorkspaceRole & {permissions: string[]})[]
}
