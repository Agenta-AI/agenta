export const DEFAULT_SETTINGS_TAB = "workspace"

export type SettingsTabKey =
    | "apiKeys"
    | "secrets"
    | "llms"
    | "tools"
    | "triggers"
    | "webhooks"
    | "workspace"
    | "projects"
    | "organizationGeneral"
    | "organization"
    | "auditLog"
    | "billing"
    | "account"
    | "preferences"

export type SettingsScopeKey = "project" | "organization" | "personal"

export interface SettingsAccess {
    billingEnabled: boolean
    canShowTools: boolean
    canShowTriggers: boolean
    canViewApiKeys: boolean
    canViewEvents: boolean
    isEE: boolean
    isOwner: boolean
}

/** A tertiary docs link rendered at the far right of a settings page header. */
export interface SettingsTabDocs {
    label: string
    href: string
}

export interface SettingsTabDefinition {
    key: SettingsTabKey
    scope: SettingsScopeKey
    showInSidebar?: boolean
    getLabel?: (access: SettingsAccess) => string
    /**
     * One sentence explaining what the page is for. Required so a new tab cannot ship
     * without one — every settings page renders this under its title.
     */
    description: string
    /** Overrides `description` when the copy depends on entitlements. */
    getDescription?: (access: SettingsAccess) => string
    docs?: SettingsTabDocs
}

const DOCS_BASE = "https://docs.agenta.ai"

export const SETTINGS_TABS: SettingsTabDefinition[] = [
    {
        key: "apiKeys",
        scope: "project",
        description:
            "Keys authenticate requests to the Agenta API from your code, CI jobs, and SDKs. A key is shown once, at creation.",
        docs: {label: "Using the API", href: `${DOCS_BASE}/reference/api-guide/overview`},
    },
    {
        key: "secrets",
        scope: "project",
        description:
            "Credentials your workflows read at runtime. Values are encrypted and never displayed again after they are saved.",
    },
    {
        key: "llms",
        scope: "project",
        description:
            "Bring your own provider keys. Agenta uses them for playground runs, evaluations, and deployed workflows.",
        docs: {label: "Provider setup", href: `${DOCS_BASE}/faq/integrations/llm-providers`},
    },
    {
        key: "tools",
        scope: "project",
        description:
            "Integrations your agents can call as tools. The slug is what you reference in code.",
        docs: {label: "About tools", href: `${DOCS_BASE}/concepts/tools-and-integrations`},
    },
    {
        key: "triggers",
        scope: "project",
        description:
            "Run workflows automatically — on a schedule, or when a connected app sends an event.",
        docs: {label: "About automations", href: `${DOCS_BASE}/concepts/automations`},
    },
    {
        key: "webhooks",
        scope: "project",
        description:
            "Send workflow events to your own HTTP endpoints, with signed payloads and delivery retries.",
    },
    {
        key: "organizationGeneral",
        scope: "organization",
        description:
            "Every organization you belong to. Rename, transfer ownership, or delete one from its row menu.",
        docs: {
            label: "About organizations",
            href: `${DOCS_BASE}/administration/access-control/organizations`,
        },
    },
    {
        key: "workspace",
        scope: "organization",
        description:
            "People with access to this organization. Invitations appear here until they are accepted or expire.",
        docs: {
            label: "Roles and permissions",
            href: `${DOCS_BASE}/administration/access-control/rbac`,
        },
    },
    {
        key: "projects",
        scope: "organization",
        description:
            "Projects keep agents, datasets, and deployments separate. Every API call is scoped to one project ID.",
        docs: {
            label: "About projects",
            href: `${DOCS_BASE}/administration/access-control/organizations`,
        },
    },
    {
        key: "organization",
        scope: "organization",
        description:
            "Control how members sign in and which email domains are allowed to join this organization.",
        docs: {label: "SSO setup", href: `${DOCS_BASE}/administration/access-control/sso`},
    },
    {
        key: "auditLog",
        scope: "organization",
        description: "A record of who changed what in this organization, and when.",
    },
    {
        key: "billing",
        scope: "organization",
        getLabel: ({billingEnabled}) => (billingEnabled ? "Usage & Billing" : "Usage"),
        description: "Track how much of your plan you have used.",
        getDescription: ({billingEnabled}) =>
            billingEnabled
                ? "Track how much of your plan you have used, and manage your subscription."
                : "Track how much of your plan you have used.",
    },
    {
        key: "account",
        scope: "personal",
        description:
            "Your personal profile. These details are visible to other members of your organizations.",
    },
    {
        key: "preferences",
        scope: "personal",
        description:
            "Personal settings for this browser. They are stored on this device and are not shared with your organizations.",
    },
]

export const SETTINGS_SCOPES: {key: SettingsScopeKey; title: string}[] = [
    {key: "project", title: "Project"},
    {key: "organization", title: "Organization"},
    {key: "personal", title: "Personal"},
]

const SETTINGS_LABELS: Record<Exclude<SettingsTabKey, "billing">, string> = {
    apiKeys: "API Keys",
    secrets: "Secrets",
    llms: "LLMs",
    tools: "Tools",
    triggers: "Triggers",
    webhooks: "Webhooks",
    workspace: "Members",
    projects: "Projects",
    organizationGeneral: "Organizations",
    organization: "Access & Security",
    auditLog: "Audit Log",
    account: "Account",
    preferences: "Preferences",
}

export const isSettingsTabKey = (value: string | null | undefined): value is SettingsTabKey =>
    !!value && SETTINGS_TABS.some((tab) => tab.key === value)

export const getSettingsTabLabel = (key: SettingsTabKey, access: SettingsAccess) => {
    const tab = SETTINGS_TABS.find((item) => item.key === key)
    if (tab?.getLabel) return tab.getLabel(access)
    return SETTINGS_LABELS[key as Exclude<SettingsTabKey, "billing">]
}

export const getSettingsTabDescription = (key: SettingsTabKey, access: SettingsAccess): string => {
    const tab = SETTINGS_TABS.find((item) => item.key === key)
    if (!tab) return ""
    return tab.getDescription ? tab.getDescription(access) : tab.description
}

export const getSettingsTabDocs = (key: SettingsTabKey): SettingsTabDocs | undefined =>
    SETTINGS_TABS.find((item) => item.key === key)?.docs

// `organizationGeneral` is intentionally absent: it lists every organization you belong
// to, so membership is enough. Its destructive row actions gate on ownership per row.
export const isSettingsTabVisible = (key: SettingsTabKey, access: SettingsAccess) => {
    switch (key) {
        case "apiKeys":
            return access.canViewApiKeys
        case "tools":
            return access.canShowTools
        case "triggers":
            return access.canShowTriggers
        case "organization":
            return access.isEE && access.isOwner
        case "auditLog":
            return access.isEE && access.canViewEvents
        case "billing":
            return access.isEE && access.isOwner
        case "account":
            return access.isEE
        default:
            return true
    }
}

export const resolveSettingsTab = (
    requestedTab: string | null | undefined,
    access: SettingsAccess,
): SettingsTabKey => {
    if (!isSettingsTabKey(requestedTab)) return DEFAULT_SETTINGS_TAB
    return isSettingsTabVisible(requestedTab, access) ? requestedTab : DEFAULT_SETTINGS_TAB
}

export const getSettingsSidebarTabs = (access: SettingsAccess) =>
    SETTINGS_TABS.filter((tab) => tab.showInSidebar !== false).map((tab) => ({
        ...tab,
        title: getSettingsTabLabel(tab.key, access),
        isHidden: !isSettingsTabVisible(tab.key, access),
    }))
